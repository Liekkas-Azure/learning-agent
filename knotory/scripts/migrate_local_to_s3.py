#!/usr/bin/env python3
"""将本地 ~/knotory-data 语料与 knotory.db 上传到 S3 兼容对象存储。"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# 允许从仓库根或 knotory 目录执行
BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def main() -> int:
    parser = argparse.ArgumentParser(description="迁移本地 Knotory 语料到 S3")
    parser.add_argument(
        "--source",
        default="~/knotory-data",
        help="本地数据目录（含 raw/ wiki/ outputs/ knotory.db）",
    )
    parser.add_argument("--bucket", required=True, help="S3 桶名")
    parser.add_argument("--prefix", default="knotory", help="对象前缀，默认 knotory")
    parser.add_argument("--endpoint", default="", help="S3 兼容端点（MinIO/R2/OSS）")
    parser.add_argument("--access-key", default="", help="Access Key ID")
    parser.add_argument("--secret-key", default="", help="Secret Access Key")
    parser.add_argument("--region", default="auto", help="区域")
    parser.add_argument("--dry-run", action="store_true", help="仅列出将上传的文件")
    args = parser.parse_args()

    import boto3  # noqa: PLC0415
    from botocore.config import Config  # noqa: PLC0415

    source = Path(args.source).expanduser().resolve()
    if not source.is_dir():
        print(f"源目录不存在: {source}", file=sys.stderr)
        return 1

    prefix = args.prefix.strip().strip("/") + "/"
    session = boto3.session.Session(
        aws_access_key_id=args.access_key or None,
        aws_secret_access_key=args.secret_key or None,
        region_name=args.region or None,
    )
    client_kwargs: dict = {"config": Config(signature_version="s3v4")}
    if args.endpoint.strip():
        client_kwargs["endpoint_url"] = args.endpoint.strip()
    client = session.client("s3", **client_kwargs)

    uploaded = 0
    for path in sorted(source.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(source).as_posix()
        key = f"{prefix}{rel}"
        if args.dry_run:
            print(f"would upload: {path} -> s3://{args.bucket}/{key}")
            uploaded += 1
            continue
        client.upload_file(str(path), args.bucket, key)
        print(f"uploaded: s3://{args.bucket}/{key}")
        uploaded += 1

    print(f"完成：共 {uploaded} 个对象（前缀 {prefix.rstrip('/')}/）")
    print("请将 backend/.env 设为 KNOTORY_STORAGE_BACKEND=s3 并填写相同桶配置后重启服务。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
