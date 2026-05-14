import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GMAIL_USER = 'neltec.system@gmail.com';
const GMAIL_PASS = 'lhvlzwhejiosqrcs';
const SUPABASE_URL = 'https://nccognptoprhwsbjnwcu.supabase.co';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

function encodeBase64(str: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}

function encodeBase64Chunked(str: string): string {
  const raw = encodeBase64(str);
  return raw.match(/.{1,76}/g)?.join('\r\n') || raw;
}

async function sendMail(to: string, subject: string, html: string) {
  const conn = await (Deno as any).connectTls({ hostname: 'smtp.gmail.com', port: 465 });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  async function read(): Promise<string> {
    const buf = new Uint8Array(4096);
    const n = await conn.read(buf);
    return n ? decoder.decode(buf.subarray(0, n)) : '';
  }

  async function write(data: string) {
    await conn.write(encoder.encode(data));
  }

  async function cmd(data: string): Promise<string> {
    await write(data + '\r\n');
    return await read();
  }

  await read();
  await cmd('EHLO localhost');
  await cmd('AUTH LOGIN');
  await cmd(btoa(GMAIL_USER));
  const authRes = await cmd(btoa(GMAIL_PASS));
  if (!authRes.startsWith('235')) throw new Error('Auth failed: ' + authRes);

  await cmd(`MAIL FROM:<${GMAIL_USER}>`);
  await cmd(`RCPT TO:<${to}>`);
  await cmd('DATA');

  const subjectEncoded = '=?UTF-8?B?' + encodeBase64(subject) + '?=';
  const bodyEncoded = encodeBase64Chunked(html);

  const message = [
    `From: =?UTF-8?B?${encodeBase64('NexPort')}?= <${GMAIL_USER}>`,
    `To: ${to}`,
    `Subject: ${subjectEncoded}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    bodyEncoded,
    '.',
  ].join('\r\n');

  await write(message + '\r\n');
  const dataRes = await read();
  await cmd('QUIT');
  conn.close();

  if (!dataRes.includes('250')) throw new Error('Send failed: ' + dataRes);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { to, subject, body: htmlBody, user_ids, email_subject, email_body } = body;

    // Mode 1: Direct send (to, subject, body)
    if (to && subject && htmlBody) {
      await sendMail(to, subject, htmlBody);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Mode 2: Send to user_ids (lookup emails from auth)
    if (user_ids && email_subject && email_body) {
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      });

      let sent = 0;
      const errors: string[] = [];
      for (const uid of user_ids) {
        try {
          const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(uid);
          if (user?.email) {
            await sendMail(user.email, email_subject, email_body);
            sent++;
          }
        } catch (e: any) {
          errors.push(`${uid}: ${e.message}`);
        }
      }
      return new Response(JSON.stringify({ success: true, sent, errors }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid params. Use {to,subject,body} or {user_ids,email_subject,email_body}' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
