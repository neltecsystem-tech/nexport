import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VAPID_PUBLIC = 'BMn6G55iWDnmQZ7nZ79iHX2npyXgNI6fU63HK25SV9XMHmk0aIZtQMh0r2yM3Sm0GiFdJLVPlMWoyMe7NNiM420';
const VAPID_PRIVATE = 'KaQGsy_P6xGjRtm8Z51rjd-SYwv4RuHLlC296avf2Jo';
const VAPID_SUBJECT = 'mailto:neltec.system@gmail.com';
const SUPABASE_URL = 'https://nccognptoprhwsbjnwcu.supabase.co';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// JWT for VAPID
function b64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function createVapidJwt(audience: string): Promise<string> {
  const header = b64urlStr(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64urlStr(JSON.stringify({ aud: audience, exp: now + 86400, sub: VAPID_SUBJECT }));
  const data = new TextEncoder().encode(`${header}.${payload}`);

  const privateKeyBytes = b64urlDecode(VAPID_PRIVATE);
  // Import as raw EC private key (32 bytes)
  const jwk = {
    kty: 'EC', crv: 'P-256',
    d: VAPID_PRIVATE,
    x: b64url(b64urlDecode(VAPID_PUBLIC).slice(1, 33)),
    y: b64url(b64urlDecode(VAPID_PUBLIC).slice(33, 65)),
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);

  // Convert DER to raw r||s (64 bytes)
  const sigBytes = new Uint8Array(sig);
  let r: Uint8Array, s: Uint8Array;
  if (sigBytes.length === 64) {
    r = sigBytes.slice(0, 32); s = sigBytes.slice(32);
  } else {
    // DER format
    const rLen = sigBytes[3];
    const rStart = rLen === 33 ? 5 : 4;
    r = sigBytes.slice(rStart, rStart + 32);
    const sStart = rStart + 32 + 2;
    const sLen = sigBytes[sStart - 1];
    const sActualStart = sLen === 33 ? sStart + 1 : sStart;
    s = sigBytes.slice(sActualStart, sActualStart + 32);
  }
  const rawSig = new Uint8Array(64);
  rawSig.set(r); rawSig.set(s, 32);

  return `${header}.${payload}.${b64url(rawSig)}`;
}

async function sendExpoPush(token: string, payloadObj: any) {
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
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Expo push failed ${resp.status}: ${errText}`);
  }
  // Expoは2xxでもticketにエラーが乗ることがある
  const data = await resp.json().catch(() => ({}));
  const ticket = data?.data;
  if (ticket?.status === 'error') {
    throw new Error(`Expo ticket error: ${ticket.message || 'unknown'}`);
  }
}

async function sendPush(subscription: any, payload: string) {
  // Expo (Native) push?
  if (subscription?.type === 'expo' && subscription?.token) {
    const payloadObj = typeof payload === 'string' ? JSON.parse(payload) : payload;
    await sendExpoPush(subscription.token, payloadObj);
    return;
  }

  // Web Push (VAPID)
  const endpoint = subscription.endpoint;
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const jwt = await createVapidJwt(audience);
  const vapidAuth = `vapid t=${jwt}, k=${VAPID_PUBLIC}`;

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': vapidAuth,
      'Content-Type': 'application/json',
      'TTL': '86400',
    },
    body: payload,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Push failed ${resp.status}: ${errText}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action, user_id, subscription, title, body, url, user_ids } = await req.json();
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // サブスクリプション登録
    // Schema: id, user_id, endpoint, p256dh, auth, created_at
    if (action === 'subscribe') {
      if (!user_id || !subscription) throw new Error('user_id and subscription required');
      const isExpo = subscription?.type === 'expo' && subscription?.token;
      const row = isExpo
        ? { user_id, endpoint: subscription.endpoint, p256dh: '', auth: '' }
        : { user_id, endpoint: subscription.endpoint, p256dh: subscription.keys?.p256dh || '', auth: subscription.keys?.auth || '' };
      const { error } = await supabaseAdmin.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
      if (error) throw new Error('DB upsert failed: ' + error.message);
      return new Response(JSON.stringify({ success: true, type: isExpo ? 'expo' : 'webpush' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // プッシュ送信
    if (action === 'send') {
      const targetIds = user_ids || (user_id ? [user_id] : []);
      if (!targetIds.length) throw new Error('user_id or user_ids required');

      const { data: subs } = await supabaseAdmin.from('push_subscriptions').select('*').in('user_id', targetIds);
      const basePayload = { title: title || 'NexPort', body: body || '', url: url || '/', tag: 'nexport-' + Date.now() };

      // 各ユーザーごとの未読数を事前取得（バッジ用）
      const unreadByUser: Record<string, number> = {};
      await Promise.all(targetIds.map(async (uid: string) => {
        try {
          const { data } = await supabaseAdmin.rpc('get_user_unread_count', { p_user_id: uid });
          unreadByUser[uid] = typeof data === 'number' ? data : 0;
        } catch { unreadByUser[uid] = 0; }
      }));

      let sent = 0, failed = 0;
      const errors: string[] = [];
      for (const sub of (subs || [])) {
        try {
          const userBadge = unreadByUser[sub.user_id] ?? 0;
          const payloadObj: any = { ...basePayload, badge: userBadge };
          const payloadStr = JSON.stringify(payloadObj);
          if (typeof sub.endpoint === 'string' && sub.endpoint.startsWith('expo:')) {
            const token = sub.endpoint.slice(5);
            await sendExpoPush(token, payloadObj);
          } else {
            const reconstructed = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
            await sendPush(reconstructed, payloadStr);
          }
          sent++;
        } catch (e: any) {
          failed++;
          errors.push((e?.message || 'unknown').slice(0, 200));
          if (e?.message?.includes('410') || e?.message?.includes('404') || e?.message?.includes('DeviceNotRegistered')) {
            await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
        }
      }
      return new Response(JSON.stringify({ success: true, sent, failed, errors: errors.slice(0, 5) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
