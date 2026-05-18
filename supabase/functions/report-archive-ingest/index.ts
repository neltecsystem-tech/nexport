import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

const MIME_TO_GEMINI: Record<string, string> = {
  'application/pdf': 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword': 'application/msword',
  'application/vnd.ms-excel': 'application/vnd.ms-excel',
  'text/plain': 'text/plain',
  'text/csv': 'text/csv',
};

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function extractTextWithGemini(mimeType: string, bytes: Uint8Array, filename: string): Promise<string> {
  // For plain text/csv, decode directly without Gemini
  if (mimeType === 'text/plain' || mimeType === 'text/csv') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  const geminiMime = MIME_TO_GEMINI[mimeType];
  if (!geminiMime) throw new Error(`Unsupported mime type: ${mimeType}`);

  const base64 = await bytesToBase64(bytes);
  const prompt = `次のドキュメントから本文テキストを抽出してください。
- 表は読みやすいテキストに変換 (Markdown のテーブル形式が望ましい)
- ヘッダー/フッター/ページ番号は除外
- 図の中の文字も拾う
- 余計な前置きや要約は不要、抽出したテキストだけを出力
- ファイル名 (参考): ${filename}`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: geminiMime, data: base64 } },
            { text: prompt },
          ],
        }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 32768 },
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
    const title = (body.title || '').trim();
    const documentDate = (body.document_date || '').trim() || null;
    const category = (body.category || '').trim() || null;
    const notes = (body.notes || '').trim() || null;
    const mimeType = (body.mime_type || '').trim();
    const originalFilename = (body.original_filename || '').trim() || null;

    if (!storagePath || !title || !mimeType) {
      return new Response(JSON.stringify({ error: 'storage_path, title, mime_type are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Download file from storage
    const { data: fileData, error: dlErr } = await admin.storage
      .from('report-archives')
      .download(storagePath);
    if (dlErr || !fileData) {
      return new Response(JSON.stringify({ error: 'Failed to download file: ' + (dlErr?.message || 'unknown') }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const bytes = new Uint8Array(await fileData.arrayBuffer());

    // Size guard: inline_data has practical limits (~20MB for inline base64 in JSON body).
    if (bytes.length > 18 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: `File too large (${(bytes.length / 1024 / 1024).toFixed(1)}MB). Max 18MB per file.` }), {
        status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const content = await extractTextWithGemini(mimeType, bytes, originalFilename || storagePath);

    // Insert into report_archives
    const { data: inserted, error: insErr } = await admin
      .from('report_archives')
      .insert({
        title,
        document_date: documentDate,
        category,
        content,
        source_filename: originalFilename,
        source_storage_path: storagePath,
        uploaded_by: user.id,
        notes,
      })
      .select()
      .single();
    if (insErr) {
      return new Response(JSON.stringify({ error: 'DB insert failed: ' + insErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, archive: inserted, content_length: content.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
