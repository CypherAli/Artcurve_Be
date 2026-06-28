import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private lastBackupTime: Date | null = null;
  private lastBackupStatus: 'success' | 'failed' | 'never' = 'never';
  private lastBackupSize: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    // Schedule daily backup at 3 AM (only in production)
    if (this.configService.get('NODE_ENV') === 'production') {
      this.scheduleDaily();
    }
  }

  private scheduleDaily() {
    const now = new Date();
    const next3am = new Date(now);
    next3am.setHours(3, 0, 0, 0);
    if (next3am <= now) next3am.setDate(next3am.getDate() + 1);

    const msUntil = next3am.getTime() - now.getTime();
    setTimeout(() => {
      this.runBackup();
      // Then every 24 hours
      setInterval(() => this.runBackup(), 24 * 60 * 60 * 1000);
    }, msUntil);

    this.logger.log(`Backup scheduled: next run at ${next3am.toISOString()}`);
  }

  async runBackup(): Promise<{ success: boolean; filename?: string; error?: string }> {
    const dbUrl = this.configService.get<string>('DATABASE_URL');
    if (!dbUrl) {
      this.lastBackupStatus = 'failed';
      return { success: false, error: 'DATABASE_URL not configured' };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(process.cwd(), 'backups');
    const filename = `artcurve_${timestamp}.sql.gz`;
    const filepath = path.join(backupDir, filename);

    try {
      await fs.mkdir(backupDir, { recursive: true });

      // Run pg_dump and pipe to gzip
      await new Promise<void>((resolve, reject) => {
        const pgDump = spawn('pg_dump', [dbUrl, '--no-owner', '--no-privileges'], {
          env: { ...process.env },
        });
        const gzip = spawn('gzip', []);
        const output = createWriteStream(filepath);

        pgDump.stdout.pipe(gzip.stdin);
        gzip.stdout.pipe(output);

        let stderr = '';
        pgDump.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        output.on('finish', () => {
          if (stderr && stderr.includes('error')) reject(new Error(stderr));
          else resolve();
        });
        pgDump.on('error', reject);
        gzip.on('error', reject);
      });

      const stats = await fs.stat(filepath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

      this.lastBackupTime = new Date();
      this.lastBackupStatus = 'success';
      this.lastBackupSize = `${sizeMB} MB`;
      this.logger.log(`Backup complete: ${filename} (${sizeMB} MB)`);

      // Cleanup old backups (keep last 7)
      await this.cleanupOldBackups(backupDir, 7);

      return { success: true, filename };
    } catch (err) {
      this.lastBackupStatus = 'failed';
      this.logger.error(`Backup failed: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  private async cleanupOldBackups(dir: string, keepCount: number) {
    const files = await fs.readdir(dir);
    const backups = files
      .filter(f => f.startsWith('artcurve_') && f.endsWith('.sql.gz'))
      .sort()
      .reverse();

    for (const file of backups.slice(keepCount)) {
      await fs.unlink(path.join(dir, file));
      this.logger.log(`Deleted old backup: ${file}`);
    }
  }

  getStatus() {
    return {
      lastBackupTime: this.lastBackupTime?.toISOString() ?? null,
      lastBackupStatus: this.lastBackupStatus,
      lastBackupSize: this.lastBackupSize,
      nextScheduled: this.configService.get('NODE_ENV') === 'production'
        ? 'Daily at 03:00 UTC'
        : 'Disabled (non-production)',
    };
  }
}
