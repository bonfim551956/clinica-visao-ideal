import { createClient } from '@supabase/supabase-js';
const URL = 'https://gnqokiwxbamiegjrfacv.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImducW9raXd4YmFtaWVnanJmYWN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDM3NzYsImV4cCI6MjEwNjE3OTc3Nn0.RkPkZiw7EOsnuKfYc-2tjFLUmcJDeoX4tRYizUuga1o';
export const supabase = createClient(URL, KEY, {
  realtime: { params: { eventsPerSecond: 10 } }
});
