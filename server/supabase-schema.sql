-- Run this once in Supabase Dashboard → SQL Editor → New query → Run

create table if not exists users (
  id text primary key,
  username text unique not null,
  email text unique,
  password_hash text,
  avatar text,
  public_key text,
  created_at bigint not null
);

create table if not exists email_codes (
  email text primary key,
  code text not null,
  expires_at bigint not null,
  attempts int not null default 0
);

-- If you already created the users table before these columns existed, run:
-- alter table users add column if not exists password_hash text;
-- alter table users add column if not exists email text unique;

create table if not exists chats (
  id text primary key,
  is_group boolean not null default false,
  name text,
  created_at bigint not null
);

create table if not exists chat_members (
  chat_id text not null references chats(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  archived boolean default false,
  primary key (chat_id, user_id)
);

create table if not exists messages (
  id text primary key,
  chat_id text not null references chats(id) on delete cascade,
  sender_id text not null,
  content text not null default '',
  created_at bigint not null,
  status text default 'sent',
  reply_to_id text,
  media_url text,
  media_type text,
  deleted boolean default false,
  iv text,
  encrypted_keys text
);

create table if not exists reactions (
  message_id text not null references messages(id) on delete cascade,
  user_id text not null,
  emoji text not null,
  primary key (message_id, user_id)
);

create table if not exists statuses (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  content text,
  media_url text,
  media_type text,
  created_at bigint not null,
  expires_at bigint not null
);

create table if not exists status_views (
  status_id text not null references statuses(id) on delete cascade,
  viewer_id text not null,
  primary key (status_id, viewer_id)
);

create table if not exists push_subscriptions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at bigint not null
);

-- Storage bucket for uploaded files (images, voice notes, avatars)
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;
