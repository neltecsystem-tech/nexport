import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VAPID_PUBLIC = 'BIj5ekLPrEUBGswQEBrhZ4djLfSGTn5LWl1hqO7T0uBlusC4NFSZxOFwls7Np5YgaJlhytgs4lbJCSIdPhF0JJc';
const VAPID_PRIVATE = '-eOFA9dTHtwSmufGtvvYzUkS1RjTFrAKxyWV2si2H6g';
const VAPID_SUBJECT = 'mailto:neltec.system@gmail.com';

function b64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function b64urlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importVapidKeys() {
  const rawPrivate = b64urlDecode(VAPID_PRIVATE);
  const rawPublic = b64urlDecode(VAPID_PUBLIC);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256',
      x: b64urlEncode(rawPublic.slice(1, 33)),
      y: b64urlEncode(rawPublic.slice(33, 65)),
      d: b64urlEncode(rawPrivate),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  );
  return privateKey;
}

async function createJWT(audience: string, privateKey: CryptoKey): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 86400, sub: VAPID_SUBJECT };
  const enc = new TextEncoder();
  const headerB64 = b64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const input = `${headerB64}.${payloadB64}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    enc.encode(input),
  );
  const sig = new Uint8Array(signature);
  let r, s;
  if (sig[0] === 0x30) {
    const rLen = sig[3];
    r = sig.slice(4, 4 + rLen);
    const sLen = sig[5 + rLen];
    s = sig.slice(6 + rLen, 6 + rLen + sLen);
    if (r.length > 32) r = r.slice(r.length - 32);
    if (s.length > 32) s = s.slice(s.length - 32);
    const raw = new Uint8Array(64);
    raw.set(r, 32 - r.length);
    raw.set(s, 64 - s.length);
    return `${input}.${b64urlEncode(raw)}`;
  } else {
    return `${input}.${b64urlEncode(signature)}`;
  }
}

async function sendWebPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: string) {
  try {
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const privateKey = await importVapidKeys();
    const jwt = await createJWT(audience, privateKey);
    const resp = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'TTL': '86400',
        'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC}`,
      },
      body: payload,
    });
    return resp.status;
  } catch (e) {
    console.error('Push error:', e);
    return 0;
  }
}

async function sendExpoPush(token: string, payloadObj: any) {
  try {
    const body: any = {
      to: token,
      title: payloadObj.title || 'NexPort',
      body: payloadObj.body || '',
      data: { url: payloadObj.url || '/' },
      sound: 'default',
      priority: 'high',
      channelId: 'default',
    };
    if (typeof payloadObj.badge === 'number') body.badge = payloadObj.badge;
    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return 0;
    const data = await resp.json().catch(() => ({}));
    const ticket = data?.data;
    if (ticket?.status === 'error') return 500;
    return 200;
  } catch (e) {
    console.error('Expo push error:', e);
    return 0;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user_ids, title, body, url, badge } = await req.json();
    if (!user_ids || !title) {
      return new Response(JSON.stringify({ error: 'user_ids and title required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: subs } = await adminSupabase
      .from('push_subscriptions')
      .select('*')
      .in('user_id', user_ids);

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payloadObj: any = { title, body: body || '', url: url || '/' };
    if (typeof badge === 'number') payloadObj.badge = badge;
    const payload = JSON.stringify(payloadObj);
    let sent = 0;
    for (const sub of subs) {
      let status = 0;
      if (typeof sub.endpoint === 'string' && sub.endpoint.startsWith('expo:')) {
        const token = sub.endpoint.slice(5);
        status = await sendExpoPush(token, payloadObj);
      } else {
        status = await sendWebPush(sub, payload);
      }
      if (status >= 200 && status < 300) sent++;
      if (status === 410 || status === 404) {
        await adminSupabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }

    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
