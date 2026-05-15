import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

async function extractWithGemini(imageBase64: string, mimeType: string) {
  const prompt = `次の画像は日本のビジネス名刺です。記載情報を以下のJSONに抽出してください。

抽出ルール:
- 読み取れない項目は空文字列
- 電話番号は半角ハイフン区切り (例: 03-1234-5678)
- 携帯電話 (090/080/070始まり) は mobile、それ以外の固定電話・代表番号は phone
- 会社名は「株式会社」「有限会社」を含む正式名称
- 氏名は姓と名のあいだに半角スペース1つ
- 住所は郵便番号、都道府県、市区町村、番地、ビル名・階数まで含める
- 役職と部署名は別々のフィールドに分ける（例: 「営業部 部長」→ department: "営業部", title: "部長"）

期待JSONフィールド:
{
  "company_name": "",
  "department": "",
  "person_name": "",
  "title": "",
  "phone": "",
  "mobile": "",
  "email": "",
  "address": "",
  "website": ""
}`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
        },
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${errText.slice(0, 500)}`);
  }
  const result = await resp.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return JSON.parse(text);
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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

    const { image_base64, mime_type } = await req.json();
    if (!image_base64) {
      return new Response(JSON.stringify({ error: 'image_base64 is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await extractWithGemini(image_base64, mime_type || 'image/jpeg');

    const result = {
      company_name: String(data.company_name || ''),
      department: String(data.department || ''),
      person_name: String(data.person_name || ''),
      title: String(data.title || ''),
      phone: String(data.phone || ''),
      mobile: String(data.mobile || ''),
      email: String(data.email || ''),
      address: String(data.address || ''),
      website: String(data.website || ''),
    };

    if (!result.company_name && !result.person_name && !result.email && !result.phone) {
      return new Response(JSON.stringify({ error: '名刺の情報を読み取れませんでした。明るい場所で撮り直してください。' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
