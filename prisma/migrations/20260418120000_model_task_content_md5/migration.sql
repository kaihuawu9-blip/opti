-- AlterTable
ALTER TABLE "model_tasks" ADD COLUMN "image_content_md5" TEXT;

-- CreateIndex
CREATE INDEX "model_tasks_image_content_md5_idx" ON "model_tasks"("image_content_md5");

-- CreateIndex
CREATE INDEX "model_tasks_image_url_idx" ON "model_tasks"("image_url");
