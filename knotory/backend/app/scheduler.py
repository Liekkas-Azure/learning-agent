"""伴读定时任务：每日按最新知识库指纹刷新全部 wiki 的伴读缓存。"""

from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.backup_jobs import run_scheduled_backup
from app.companion_jobs import refresh_all_wikis_companions
from app.config import settings
from app.corpus_store import sync_database_if_cloud
from app.flashcard_ingest import scan_watch_folder

logger = logging.getLogger("knotory.scheduler")

_scheduler: BackgroundScheduler | None = None


def start_companion_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    sched = BackgroundScheduler(timezone=settings.companion_cron_timezone)

    if settings.companion_scheduler_enabled:
        hour = max(0, min(settings.companion_cron_hour, 23))
        minute = max(0, min(settings.companion_cron_minute, 59))
        sched.add_job(
            _daily_companion_job,
            CronTrigger(hour=hour, minute=minute),
            id="knotory_reading_companion_daily",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info(
            "伴读定时任务已启动：每日 %02d:%02d（%s）",
            hour,
            minute,
            settings.companion_cron_timezone,
        )
    else:
        logger.info("伴读定时任务未启用（KNOTORY_COMPANION_CRON_ENABLED=false）")

    if settings.backup_scheduler_enabled:
        bh = max(0, min(settings.backup_cron_hour, 23))
        bm = max(0, min(settings.backup_cron_minute, 59))
        sched.add_job(
            run_scheduled_backup,
            CronTrigger(hour=bh, minute=bm),
            id="knotory_backup_daily",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info("语料自动备份：每日 %02d:%02d", bh, bm)

    if settings.watch_scheduler_enabled and (settings.watch_dir or "").strip():
        wh = max(0, min(settings.watch_cron_hour, 23))
        wm = max(0, min(settings.watch_cron_minute, 59))
        sched.add_job(
            _watch_folder_job,
            CronTrigger(hour=wh, minute=wm),
            id="knotory_watch_scan_daily",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info("监视目录扫描：每日 %02d:%02d", wh, wm)

    if settings.resolved_storage_backend == "s3" and (settings.s3_bucket or "").strip():
        sched.add_job(
            sync_database_if_cloud,
            CronTrigger(minute="*/5"),
            id="knotory_s3_db_sync",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info("S3 数据库同步：每 5 分钟推送 knotory.db")

    if sched.get_jobs():
        sched.start()
        _scheduler = sched


def shutdown_companion_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    try:
        _scheduler.shutdown(wait=False)
    except Exception as exc:  # noqa: BLE001
        logger.warning("scheduler shutdown: %s", exc)
    _scheduler = None


def _daily_companion_job() -> None:
    logger.info("开始每日伴读刷新（按章节输入指纹与书架摘要变化增量重算）")
    try:
        refresh_all_wikis_companions(force_refresh=False)
    except Exception:  # noqa: BLE001
        logger.exception("每日伴读刷新失败")


def _watch_folder_job() -> None:
    logger.info("开始监视目录定时扫描")
    try:
        scan_watch_folder()
    except Exception:  # noqa: BLE001
        logger.exception("监视目录扫描失败")
