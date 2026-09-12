// Single Supabase client instance, shared by all pages.
const SUPABASE_URL = 'https://srlsyxlkcgscbngbrqzw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNybHN5eGxrY2dzY2JuZ2JycXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNTgzMTEsImV4cCI6MjEwNDczNDMxMX0.fEF072sPIZ_POYlMzKQxJIty7leWogJ2aDU2yqLiXCQ';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 5 } },
});
