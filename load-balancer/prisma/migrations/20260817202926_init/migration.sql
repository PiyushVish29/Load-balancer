-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestRecord" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serverId" TEXT,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTimeMs" DOUBLE PRECISION NOT NULL,
    "algorithm" TEXT NOT NULL,

    CONSTRAINT "RequestRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthEvent" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestRecord_serverId_idx" ON "RequestRecord"("serverId");

-- CreateIndex
CREATE INDEX "RequestRecord_algorithm_idx" ON "RequestRecord"("algorithm");

-- CreateIndex
CREATE INDEX "RequestRecord_timestamp_idx" ON "RequestRecord"("timestamp");

-- CreateIndex
CREATE INDEX "HealthEvent_serverId_idx" ON "HealthEvent"("serverId");

-- CreateIndex
CREATE INDEX "HealthEvent_timestamp_idx" ON "HealthEvent"("timestamp");

-- AddForeignKey
ALTER TABLE "RequestRecord" ADD CONSTRAINT "RequestRecord_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthEvent" ADD CONSTRAINT "HealthEvent_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
