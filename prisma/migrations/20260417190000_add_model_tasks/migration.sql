-- CreateEnum
CREATE TYPE "ModelTaskStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAIL');

-- CreateTable
CREATE TABLE "model_tasks" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "status" "ModelTaskStatus" NOT NULL DEFAULT 'PENDING',
    "image_url" TEXT NOT NULL,
    "model_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_tasks_task_id_key" ON "model_tasks"("task_id");
