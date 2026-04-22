-- 全局镜框模型表（以图片 MD5 为主键）+ 门店使用映射；替换旧 model_tasks 结构

BEGIN;

CREATE TABLE "frame_models" (
    "content_md5" VARCHAR(32) NOT NULL,
    "task_id" TEXT NOT NULL,
    "status" "ModelTaskStatus" NOT NULL DEFAULT 'PENDING',
    "image_url" TEXT NOT NULL,
    "model_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "frame_models_pkey" PRIMARY KEY ("content_md5")
);

CREATE UNIQUE INDEX "frame_models_task_id_key" ON "frame_models"("task_id");

CREATE INDEX "frame_models_image_url_idx" ON "frame_models"("image_url");

CREATE TABLE "store_frames" (
    "id" TEXT NOT NULL,
    "store_id" UUID NOT NULL,
    "model_id" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_frames_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_frames_store_id_model_id_key" ON "store_frames"("store_id", "model_id");

CREATE INDEX "store_frames_model_id_idx" ON "store_frames"("model_id");

ALTER TABLE "store_frames" ADD CONSTRAINT "store_frames_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "store_frames" ADD CONSTRAINT "store_frames_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "frame_models"("content_md5") ON DELETE CASCADE ON UPDATE NO ACTION;

-- 从旧表迁移（仅含有效 MD5 的行；同 MD5 保留最新一条）
INSERT INTO "frame_models" ("content_md5", "task_id", "status", "image_url", "model_url", "created_at", "updated_at")
SELECT DISTINCT ON (lower(trim("image_content_md5")))
    lower(trim("image_content_md5")),
    "task_id",
    "status",
    "image_url",
    "model_url",
    "created_at",
    NOW()
FROM "model_tasks"
WHERE "image_content_md5" IS NOT NULL
  AND length(trim("image_content_md5")) = 32
ORDER BY lower(trim("image_content_md5")), "created_at" DESC;

DROP TABLE IF EXISTS "model_tasks";

COMMIT;
