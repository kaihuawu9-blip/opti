-- Opti-Bot 等 UI 读取的门店 AI 助手显示名（可选）
ALTER TABLE "store_config" ADD COLUMN IF NOT EXISTS "agent_custom_name" TEXT;
