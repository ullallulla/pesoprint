# The tools for the backup jobs and the restore test: pg_dump/pg_restore 18, age and rclone.
# Built on the host by docker compose (the backup and files-backup services) and by restore.sh.
FROM postgres:18-alpine

RUN apk add --no-cache age rclone curl tzdata

COPY backup.sh /usr/local/bin/pesoprint-backup
RUN chmod 755 /usr/local/bin/pesoprint-backup

# The nightly schedule (BACKUP_AT, FILES_BACKUP_AT) is in this time zone.
ENV TZ=Europe/Helsinki
# Remotes come from RCLONE_CONFIG_* variables (env/*.env), not a config file.
ENV RCLONE_CONFIG=/dev/null
# The tokens may not create buckets, so don't let rclone try.
ENV RCLONE_S3_NO_CHECK_BUCKET=true

USER postgres
WORKDIR /tmp
ENTRYPOINT ["pesoprint-backup"]
CMD ["help"]
