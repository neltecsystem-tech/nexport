import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

async function callGemini(prompt: string): Promise<string> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
    }
  );
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${errText.slice(0, 500)}`);
  }
  const result = await resp.json();
  return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function formatReports(reports: any[], profilesMap: Map<string, string>): string {
  return reports.map((r, i) => {
    const author = profilesMap.get(r.author_id) || '不明';
    return `### 報告書 ${i + 1}
- 報告書ID: ${r.id}
- タイトル: ${r.title}
- 報告日: ${r.report_date}
- カテゴリ: ${r.category || 'なし'}
- 作成者: ${author}
- 参加者: ${r.participants || ''}${r.external_participants ? ` (社外: ${r.external_participants})` : ''}
- ステータス: ${r.status}
- 内容:
${r.content}`;
  }).join('\n\n---\n\n');
}

function formatArchives(archives: any[]): string {
  return archives.map((a, i) => {
    return `### 過去資料 ${i + 1}
- 資料ID: ${a.id}
- タイトル: ${a.title}
- 資料日付: ${a.document_date || '不明'}
- カテゴリ: ${a.category || 'なし'}
- 元ファイル: ${a.source_filename || '不明'}
- 補足: ${a.notes || ''}
- 内容:
${a.content}`;
  }).join('\n\n---\n\n');
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const action = body.action;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const [reportsRes, archivesRes] = await Promise.all([
      admin
        .from('reports')
        .select('id, author_id, title, report_date, category, participants, external_participants, content, status, approved_at')
        .order('report_date', { ascending: false })
        .limit(200),
      admin
        .from('report_archives')
        .select('id, title, document_date, category, content, source_filename, notes')
        .order('document_date', { ascending: false, nullsFirst: false })
        .limit(100),
    ]);

    if (reportsRes.error) throw new Error('reports fetch failed: ' + reportsRes.error.message);
    if (archivesRes.error) throw new Error('archives fetch failed: ' + archivesRes.error.message);
    const reports = reportsRes.data || [];
    const archives = archivesRes.data || [];
    if (reports.length === 0 && archives.length === 0) {
      return new Response(JSON.stringify({ error: '参照可能な報告書・過去資料がありません' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authorIds = [...new Set(reports.map(r => r.author_id).filter(Boolean))];
    let profilesMap = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, display_name')
        .in('id', authorIds);
      profilesMap = new Map<string, string>(
        (profiles || []).map((p: any) => [p.id, p.display_name || ''])
      );
    }

    const reportsText = reports.length > 0 ? formatReports(reports, profilesMap) : '(報告書なし)';
    const archivesText = archives.length > 0 ? formatArchives(archives) : '';

    if (action === 'query') {
      const question = (body.question || '').trim();
      if (!question) {
        return new Response(JSON.stringify({ error: 'question is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const prompt = `あなたは「ネルテック社の社内報告書アシスタント」です。
以下の社内報告書および過去資料を根拠に、ユーザーの質問に答えてください。

== 厳守ルール ==
- 報告書・過去資料に書かれていない情報は推測せず「資料には記載がありません」と返す
- 必ず根拠の資料種別 (報告書 or 過去資料) + タイトル + 日付を引用する (例: 「報告書『○○商事打合せ』(2026-05-10) に記載」「過去資料『2024年事業計画書』(2024-04-01) に記載」)
- 複数の資料にまたがる場合は時系列で整理する
- 個人名・社外社名はそのまま記載してよい (社内利用前提)
- 回答は日本語、簡潔に、必要なら箇条書きで

== 参照可能な報告書 (${reports.length}件、報告日の新しい順) ==
${reportsText}

== 参照可能な過去資料 (${archives.length}件、資料日付の新しい順) ==
${archivesText || '(過去資料なし)'}

== ユーザーの質問 ==
${question}

== 回答 ==`;
      const answer = await callGemini(prompt);
      return new Response(JSON.stringify({ success: true, answer, report_count: reports.length, archive_count: archives.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'draft') {
      const topic = (body.topic || '').trim();
      const category = (body.category || '').trim();
      const participants = (body.participants || '').trim();
      const externalParticipants = (body.external_participants || '').trim();
      const reportDate = (body.report_date || '').trim();
      const notes = (body.notes || '').trim();
      if (!topic) {
        return new Response(JSON.stringify({ error: 'topic is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const prompt = `あなたは「ネルテック社の社内報告書ドラフトアシスタント」です。
過去の報告書および過去資料を参考に、これから書く新規報告書の本文ドラフトを作成してください。

== 厳守ルール ==
- 過去報告書のスタイルとフォーマット (見出し、箇条書きの使い方、文体) を踏襲する
- 過去資料 (本ツール導入前の旧資料) は事実関係の参照に使用する
- 内容を勝手に決め込まず、不明な部分は「【要記入】」「【要確認】」などのプレースホルダで補う
- 議題の構成、結論の書き方、アクションアイテムの整理方法を過去事例から学ぶ
- 出力は本文のみ。タイトルや参加者などのメタ情報は含めない
- 日本語、自然な文体

== 参考にする過去の報告書 (${reports.length}件) ==
${reportsText}

== 参考にする過去資料 (${archives.length}件) ==
${archivesText || '(過去資料なし)'}

== 新規報告書の入力情報 ==
- テーマ/タイトル: ${topic}
${category ? `- カテゴリ: ${category}\n` : ''}${reportDate ? `- 報告日: ${reportDate}\n` : ''}${participants ? `- 参加者: ${participants}\n` : ''}${externalParticipants ? `- 社外参加者: ${externalParticipants}\n` : ''}${notes ? `- 補足メモ (これも反映してドラフト作成):\n${notes}\n` : ''}
== ドラフト本文 ==`;
      const draft = await callGemini(prompt);
      return new Response(JSON.stringify({ success: true, draft, report_count: reports.length, archive_count: archives.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action. Use "query" or "draft".' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
