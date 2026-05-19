import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

const AUDIO_MIME_OK = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/aac', 'audio/flac',
]);

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Upload audio to Gemini Files API for large files (>15MB inline limit)
async function uploadToGeminiFilesAPI(bytes: Uint8Array, mimeType: string): Promise<{ uri: string; name: string }> {
  // 1) Start resumable upload
  const startResp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'meeting-audio' } }),
    }
  );
  const uploadUrl = startResp.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    const errText = await startResp.text();
    throw new Error('Failed to start upload: ' + errText.slice(0, 300));
  }
  // 2) Upload + finalize
  const finalizeResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes,
  });
  if (!finalizeResp.ok) {
    const errText = await finalizeResp.text();
    throw new Error('Failed to finalize upload: ' + errText.slice(0, 300));
  }
  const result = await finalizeResp.json();
  if (!result.file?.uri || !result.file?.name) throw new Error('Upload returned no file URI');
  // 3) Wait for file to be ACTIVE (Gemini processes audio)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const stateResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${result.file.name}?key=${GEMINI_API_KEY}`);
    if (stateResp.ok) {
      const state = await stateResp.json();
      if (state.state === 'ACTIVE') return { uri: result.file.uri, name: result.file.name };
      if (state.state === 'FAILED') throw new Error('Gemini failed to process audio file');
    }
  }
  throw new Error('Timeout waiting for Gemini to process audio (60s)');
}

async function callGeminiWithAudio(prompt: string, audioPart: any, useFilesAPI: boolean): Promise<string> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [audioPart, { text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 32768 },
      }),
    }
  );
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${errText.slice(0, 500)}`);
  }
  const result = await resp.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty text');
  return text;
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
    const storagePath = (body.storage_path || '').trim();
    const meetingName = (body.meeting_name || '').trim() || '会議';
    const meetingDate = (body.meeting_date || '').trim() || new Date().toISOString().slice(0, 10);
    const participants = (body.participants || '').trim();
    const vocabHints = (body.vocab_hints || '').trim();
    const mimeType = (body.mime_type || '').trim();
    const createDraft = body.create_draft !== false; // default true

    if (!storagePath || !mimeType) {
      return new Response(JSON.stringify({ error: 'storage_path, mime_type are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!AUDIO_MIME_OK.has(mimeType)) {
      return new Response(JSON.stringify({ error: `Unsupported audio mime type: ${mimeType}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Download audio from storage
    const { data: fileData, error: dlErr } = await admin.storage
      .from('meeting-audio')
      .download(storagePath);
    if (dlErr || !fileData) {
      return new Response(JSON.stringify({ error: 'Failed to download audio: ' + (dlErr?.message || 'unknown') }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const bytes = new Uint8Array(await fileData.arrayBuffer());

    // Build audio part: inline if small, Files API if large
    const useFilesAPI = bytes.length > 15 * 1024 * 1024;
    let audioPart: any;
    let geminiFileName: string | null = null;
    if (useFilesAPI) {
      const { uri, name } = await uploadToGeminiFilesAPI(bytes, mimeType);
      audioPart = { file_data: { mime_type: mimeType, file_uri: uri } };
      geminiFileName = name;
    } else {
      audioPart = { inline_data: { mime_type: mimeType, data: await bytesToBase64(bytes) } };
    }

    // Build prompt
    const participantHint = participants ? `参加者リスト (発言者特定のヒント):\n${participants}` : '';
    const vocabHint = vocabHints ? `固有名詞ヒント (社内造語・社名・人名など、表記精度向上のため):\n${vocabHints}` : '';
    const prompt = `あなたは「ネルテック社の議事録作成アシスタント」です。
添付の音声ファイルを文字起こしし、ビジネス文書としての議事録を作成してください。

== コンテキスト ==
会議名: ${meetingName}
開催日: ${meetingDate}
${participantHint}
${vocabHint}

== 厳守ルール ==
- 音声の内容を忠実に拾い、雑談・休憩等の冗長部分は省略
- 数字・日付・固有名詞は正確に転記する (聞き取れない場合は【聞取困難】で明示)
- 不明な部分は推測せず「【要確認】」で残す
- 発言者が特定できる場合は「○○氏：」形式で発言を引用
- 議題ごとに整理する
- 日本語、簡潔なビジネス文書の言い回し

== 出力フォーマット ==
以下の Markdown フォーマットで出力してください (タイトルや前置きは不要、本文のみ):

## 会議概要
- 開催日時: ${meetingDate}
- 会議名: ${meetingName}
- 参加者: (音声から推測、自己紹介がない場合は上記参加者リストをそのまま記載)
- 形式: (対面/オンライン、判別不可なら【要確認】)

## 議題
1. ...
2. ...

## 議論内容
### 1. 議題1
- 要点を箇条書き
- 主要発言は「○○氏：(発言)」形式

### 2. 議題2
- ...

## 決定事項
- (明確に決まったことのみ。曖昧な合意は「【要確認】合意のニュアンスあり」と注記)

## ToDo / アクションアイテム
| 担当 | 内容 | 期限 |
|---|---|---|
| ... | ... | ... |

## 次回予定
- 日時/場所/議題 (言及があれば。なければ「【要確認】」)

== 議事録本文 ==`;

    const minutes = await callGeminiWithAudio(prompt, audioPart, useFilesAPI);

    // Cleanup Gemini Files API entry
    if (geminiFileName) {
      fetch(`https://generativelanguage.googleapis.com/v1beta/${geminiFileName}?key=${GEMINI_API_KEY}`, { method: 'DELETE' }).catch(() => {});
    }

    // Optionally create draft report
    let draftReport: any = null;
    if (createDraft) {
      const reportTitle = meetingName.length > 100 ? meetingName.slice(0, 97) + '...' : meetingName;
      const { data: inserted, error: insErr } = await admin
        .from('reports')
        .insert({
          author_id: user.id,
          title: `🎙️ ${reportTitle}`,
          report_date: meetingDate,
          category: '会議議事録',
          participants: participants || null,
          content: minutes,
          status: '下書き',
        })
        .select()
        .single();
      if (insErr) {
        console.error('Draft insert failed:', insErr);
      } else {
        draftReport = inserted;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      minutes,
      draft_report: draftReport,
      audio_size_bytes: bytes.length,
      method: useFilesAPI ? 'files_api' : 'inline',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
