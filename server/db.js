import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn(
    "WARNING: SUPABASE_URL / SUPABASE_SERVICE_KEY are not set. Set them as environment variables (see README)."
  );
}

// Service-role key bypasses RLS — this is a trusted backend-only client, never expose it to the browser.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export default supabase;
