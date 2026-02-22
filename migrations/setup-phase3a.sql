-- ============================================================
-- Phase 3A: Friend System - Database Schema
-- ============================================================

-- 1. Friend Requests Table
-- Stores pending/accepted/rejected friend requests
CREATE TABLE IF NOT EXISTS friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  to_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(from_user_id, to_user_id)
);

-- 2. Friendships Table
-- Stores accepted friendships (bidirectional)
CREATE TABLE IF NOT EXISTS friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id UUID REFERENCES users(id) ON DELETE CASCADE,
  user_b_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_a_id, user_b_id),
  CHECK (user_a_id != user_b_id)
);

-- 3. Enable Row Level Security
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies (allow all for service_role, frontend uses anon key)
DO $$ BEGIN
  CREATE POLICY "fr_all" ON friend_requests FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "fs_all" ON friendships FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_friend_requests_from ON friend_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_user_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_status ON friend_requests(status);
CREATE INDEX IF NOT EXISTS idx_friendships_user_a ON friendships(user_a_id);
CREATE INDEX IF NOT EXISTS idx_friendships_user_b ON friendships(user_b_id);

-- 6. Function to automatically create friendship when request is accepted
CREATE OR REPLACE FUNCTION create_friendship_on_accept()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    -- Insert friendship with smaller user_id as user_a_id
    INSERT INTO friendships (user_a_id, user_b_id)
    VALUES (
      LEAST(NEW.from_user_id, NEW.to_user_id),
      GREATEST(NEW.from_user_id, NEW.to_user_id)
    )
    ON CONFLICT (user_a_id, user_b_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Trigger for auto-creating friendship
DROP TRIGGER IF EXISTS trg_friend_request_accept ON friend_requests;
CREATE TRIGGER trg_friend_request_accept
  AFTER UPDATE ON friend_requests
  FOR EACH ROW
  EXECUTE FUNCTION create_friendship_on_accept();

-- 8. Function to delete friendship when rejected or request deleted
CREATE OR REPLACE FUNCTION delete_friendship_on_reject()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'accepted' AND NEW.status = 'rejected' THEN
    DELETE FROM friendships
    WHERE (user_a_id = LEAST(OLD.from_user_id, OLD.to_user_id)
       AND user_b_id = GREATEST(OLD.from_user_id, OLD.to_user_id));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_friend_request_reject ON friend_requests;
CREATE TRIGGER trg_friend_request_reject
  AFTER UPDATE ON friend_requests
  FOR EACH ROW
  EXECUTE FUNCTION delete_friendship_on_reject();

-- 9. Comments
COMMENT ON TABLE friend_requests IS '好友请求表 - 存储好友请求（pending/accepted/rejected）';
COMMENT ON TABLE friendships IS '好友关系表 - 存储已建立的好友关系（双向）';
