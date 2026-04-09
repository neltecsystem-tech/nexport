import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nccognptoprhwsbjnwcu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jY29nbnB0b3ByaHdzYmpud2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDU0NDEsImV4cCI6MjA4OTkyMTQ0MX0.M3h31uPyKYWlNevVW3OvZOonoTidC1KLZ04sB5nRKzU';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
    timeout: 20000,
    heartbeatIntervalMs: 15000,
  },
});