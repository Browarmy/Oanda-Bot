CREATE TABLE `adaptiveThresholds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`signalType` enum('CROSSOVER_BUY','CROSSOVER_SELL','RSI_PULLBACK_BUY','RSI_PULLBACK_SELL') NOT NULL,
	`rsiLowerBand` decimal(5,2) NOT NULL,
	`rsiUpperBand` decimal(5,2) NOT NULL,
	`confidenceThreshold` int NOT NULL,
	`winRate` decimal(5,2) NOT NULL DEFAULT 0,
	`lastUpdated` datetime NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `adaptiveThresholds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dailyLossGuard` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`maxDrawdownPercent` decimal(8,4) NOT NULL,
	`currentDrawdownPercent` decimal(8,4) NOT NULL DEFAULT 0,
	`isPaused` boolean NOT NULL DEFAULT false,
	`pausedAt` datetime,
	`initialNav` decimal(12,2) NOT NULL,
	`peakNav` decimal(12,2) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dailyLossGuard_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `equitySnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tradeId` int NOT NULL,
	`nav` decimal(12,2) NOT NULL,
	`navPercent` decimal(8,4) NOT NULL,
	`drawdownPercent` decimal(8,4) NOT NULL,
	`timestamp` datetime NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `equitySnapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessionConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sessionName` enum('LONDON','NEW_YORK','TOKYO','SYDNEY') NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`startHour` int NOT NULL,
	`startMinute` int NOT NULL DEFAULT 0,
	`endHour` int NOT NULL,
	`endMinute` int NOT NULL DEFAULT 0,
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sessionConfig_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `signalPerformance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`signalType` enum('CROSSOVER_BUY','CROSSOVER_SELL','RSI_PULLBACK_BUY','RSI_PULLBACK_SELL') NOT NULL,
	`outcome` enum('WIN','LOSS') NOT NULL,
	`pnl` decimal(12,2) NOT NULL,
	`rsiAtEntry` decimal(5,2) NOT NULL,
	`rsiLowerBand` decimal(5,2) NOT NULL,
	`rsiUpperBand` decimal(5,2) NOT NULL,
	`confidence` int NOT NULL,
	`tradeId` int NOT NULL,
	`recordedAt` datetime NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signalPerformance_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`oandaTradeId` varchar(64) NOT NULL,
	`instrument` varchar(32) NOT NULL,
	`direction` enum('BUY','SELL') NOT NULL,
	`entryPrice` decimal(10,5) NOT NULL,
	`exitPrice` decimal(10,5) NOT NULL,
	`units` int NOT NULL,
	`pnl` decimal(12,2) NOT NULL,
	`pnlPercent` decimal(8,4) NOT NULL,
	`signalType` enum('CROSSOVER_BUY','CROSSOVER_SELL','RSI_PULLBACK_BUY','RSI_PULLBACK_SELL') NOT NULL,
	`rsiAtEntry` decimal(5,2) NOT NULL,
	`atrAtEntry` decimal(10,5) NOT NULL,
	`stopLossPrice` decimal(10,5) NOT NULL,
	`takeProfitPrice` decimal(10,5) NOT NULL,
	`candlePeriod` int NOT NULL,
	`entryTime` datetime NOT NULL,
	`exitTime` datetime NOT NULL,
	`durationSeconds` int NOT NULL,
	`sessionWindow` varchar(32),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `userId_idx` ON `adaptiveThresholds` (`userId`);--> statement-breakpoint
CREATE INDEX `signalType_idx` ON `adaptiveThresholds` (`signalType`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `dailyLossGuard` (`userId`);--> statement-breakpoint
CREATE INDEX `date_idx` ON `dailyLossGuard` (`date`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `equitySnapshots` (`userId`);--> statement-breakpoint
CREATE INDEX `timestamp_idx` ON `equitySnapshots` (`timestamp`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `sessionConfig` (`userId`);--> statement-breakpoint
CREATE INDEX `sessionName_idx` ON `sessionConfig` (`sessionName`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `signalPerformance` (`userId`);--> statement-breakpoint
CREATE INDEX `signalType_idx` ON `signalPerformance` (`signalType`);--> statement-breakpoint
CREATE INDEX `recordedAt_idx` ON `signalPerformance` (`recordedAt`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `trades` (`userId`);--> statement-breakpoint
CREATE INDEX `entryTime_idx` ON `trades` (`entryTime`);--> statement-breakpoint
CREATE INDEX `signalType_idx` ON `trades` (`signalType`);