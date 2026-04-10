"""
SatvAAh — services/scraping/main.py
FastAPI entry point for the scraping service (port 3010).

Responsibilities:
  - Pre-launch scraping orchestration via REST triggers
  - SQS scraping job queue consumption
  - Health and readiness endpoints (required by docker-compose healthcheck)
  - Webhooks for outreach schedule updates from Lambda:outreach-scheduler

All heavy work (Scrapy spiders, NLP, dedup, pg_loader) lives in sub-modules.
This file only wires FastAPI routes and startup/shutdown lifecycle.

Docker-compose runs: uvicorn main:app --host 0.0.0.0 --port 3010 --reload
Healthcheck:         GET /health → 200 { "status": "ok" }

Env vars (injected by docker-compose environment: section):
  DATABASE_URL, REDIS_URL, MONGODB_URL
  AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
  SQS_SCRAPING_QUEUE_URL, LAMBDA_SCRAPING_ORCHESTRATOR_ARN
  S3_BUCKET_NAME, ANTHROPIC_API_KEY
  ENV, PORT
"""

from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import boto3
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.DEBUG if os.getenv("ENV", "development") == "development" else logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("satvaaah.scraping")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DATABASE_URL: str = os.environ["DATABASE_URL"]
REDIS_URL: str = os.environ["REDIS_URL"]
MONGODB_URL: str = os.environ["MONGODB_URL"]
AWS_REGION: str = os.getenv("AWS_REGION", "ap-south-1")
SQS_SCRAPING_QUEUE_URL: str = os.getenv("SQS_SCRAPING_QUEUE_URL", "")
PORT: int = int(os.getenv("PORT", "3010"))
ENV: str = os.getenv("ENV", "development")

# ---------------------------------------------------------------------------
# SQS client (lazy — only needed for job dispatch endpoints)
# ---------------------------------------------------------------------------
_sqs_client: Any = None


def get_sqs() -> Any:
    global _sqs_client
    if _sqs_client is None:
        _sqs_client = boto3.client(
            "sqs",
            region_name=AWS_REGION,
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        )
    return _sqs_client


# ---------------------------------------------------------------------------
# Lifespan: startup / shutdown hooks
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "SatvAAh scraping service starting",
        extra={"port": PORT, "env": ENV},
    )
    # Future: initialise DB connection pool, MongoDB client, Redis connection
    yield
    logger.info("SatvAAh scraping service shutting down")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="SatvAAh Scraping Service",
    description=(
        "Pre-launch provider scraping, NLP extraction, deduplication, "
        "and WhatsApp outreach scheduling for SatvAAh."
    ),
    version="1.0.0",
    docs_url="/docs" if ENV == "development" else None,
    redoc_url=None,
    lifespan=lifespan,
)

# CORS — internal service, only satvaaah-net traffic expected
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3099").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# X-Correlation-ID middleware (MASTER_CONTEXT Rule 25)
# Every request must carry X-Correlation-ID. Generate if absent.
# ---------------------------------------------------------------------------
@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    correlation_id = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Correlation-ID"] = correlation_id
    return response


# ---------------------------------------------------------------------------
# Standard response helpers
# (API response format from MASTER_CONTEXT — every endpoint, no exceptions)
#   Success:  { "success": true,  "data": { ... } }
#   Error:    { "success": false, "error": { "code": "...", "message": "..." } }
# ---------------------------------------------------------------------------
def success(data: Any) -> dict:
    return {"success": True, "data": data}


def error_response(code: str, message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "error": {"code": code, "message": message}},
    )


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class ScrapingJobRequest(BaseModel):
    """Trigger a scraping job for a specific source and city."""

    source: str = Field(
        ...,
        description="Scraping source: justdial | google_places | sulekha | practo | indiamart",
        examples=["justdial"],
    )
    city_id: str = Field(..., description="UUID of the city to scrape (from cities table)")
    taxonomy_node_id: str | None = Field(
        None,
        description="Narrow scrape to a specific taxonomy node (optional)",
    )
    correlation_id: str | None = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="X-Correlation-ID — passed to SQS and Lambda",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "source": "justdial",
                "city_id": "550e8400-e29b-41d4-a716-446655440000",
                "taxonomy_node_id": None,
            }
        }


class OutreachWebhookPayload(BaseModel):
    """Payload sent by Lambda:outreach-scheduler to update schedule status."""

    provider_id: str
    whatsapp_phone: str
    attempt_number: int = Field(ge=1, le=3)
    status: str = Field(description="sent | failed | opted_out")
    correlation_id: str | None = None


VALID_SOURCES = {"justdial", "google_places", "sulekha", "practo", "indiamart"}


# ---------------------------------------------------------------------------
# Health & readiness endpoints
# (Docker-compose healthcheck polls GET /health)
# ---------------------------------------------------------------------------
@app.get(
    "/health",
    summary="Health check",
    response_description="Service health status",
    tags=["Health"],
)
async def health() -> dict:
    """
    Docker-compose healthcheck endpoint.
    Returns 200 while the process is alive.
    Does NOT check DB/Redis/MongoDB connectivity — those are infra health.
    """
    return success(
        {
            "status": "ok",
            "service": "scraping",
            "port": PORT,
            "env": ENV,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )


@app.get(
    "/ready",
    summary="Readiness check",
    tags=["Health"],
)
async def readiness() -> dict:
    """
    Readiness probe — confirms dependencies are reachable.
    Returns 200 if DATABASE_URL and MONGODB_URL are set (not blank).
    Future: add actual DB ping.
    """
    issues = []
    if not DATABASE_URL:
        issues.append("DATABASE_URL not set")
    if not MONGODB_URL:
        issues.append("MONGODB_URL not set")
    if not REDIS_URL:
        issues.append("REDIS_URL not set")

    if issues:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=success({"status": "not_ready", "issues": issues}),
        )

    return success({"status": "ready"})


# ---------------------------------------------------------------------------
# Scraping job trigger
# POST /api/v1/scraping/jobs
# Internal endpoint — called by admin service or EventBridge via Lambda.
# ---------------------------------------------------------------------------
@app.post(
    "/api/v1/scraping/jobs",
    summary="Trigger a scraping job",
    status_code=status.HTTP_202_ACCEPTED,
    tags=["Scraping"],
)
async def trigger_scraping_job(payload: ScrapingJobRequest, request: Request) -> dict:
    """
    Enqueue a scraping job onto SQS_SCRAPING_QUEUE_URL.
    The job will be picked up by Lambda:outreach-scheduler or processed
    directly by the scraping pipeline sub-modules.

    Supported sources: justdial, google_places, sulekha, practo, indiamart
    """
    if payload.source not in VALID_SOURCES:
        return error_response(
            "INVALID_SCRAPING_SOURCE",
            f"Source '{payload.source}' is not supported. "
            f"Valid sources: {', '.join(sorted(VALID_SOURCES))}",
        )

    correlation_id = (
        request.headers.get("X-Correlation-ID")
        or payload.correlation_id
        or str(uuid.uuid4())
    )
    job_id = str(uuid.uuid4())

    # Enqueue to SQS if queue URL is configured
    if SQS_SCRAPING_QUEUE_URL:
        try:
            sqs = get_sqs()
            sqs.send_message(
                QueueUrl=SQS_SCRAPING_QUEUE_URL,
                MessageBody=str(
                    {
                        "job_id": job_id,
                        "source": payload.source,
                        "city_id": payload.city_id,
                        "taxonomy_node_id": payload.taxonomy_node_id,
                        "correlation_id": correlation_id,
                        "enqueued_at": datetime.now(timezone.utc).isoformat(),
                    }
                ),
                MessageAttributes={
                    "source": {"StringValue": payload.source, "DataType": "String"},
                    "correlation_id": {
                        "StringValue": correlation_id,
                        "DataType": "String",
                    },
                },
            )
            logger.info(
                "Scraping job enqueued",
                extra={
                    "job_id": job_id,
                    "source": payload.source,
                    "city_id": payload.city_id,
                    "correlation_id": correlation_id,
                },
            )
        except Exception as exc:
            logger.error(
                "Failed to enqueue scraping job",
                exc_info=exc,
                extra={"correlation_id": correlation_id},
            )
            return error_response(
                "SQS_ENQUEUE_FAILED",
                "Failed to enqueue scraping job. Please retry.",
                status_code=503,
            )
    else:
        # Dev mode — SQS not configured, log intent only
        logger.warning(
            "SQS_SCRAPING_QUEUE_URL not set — job logged but not enqueued",
            extra={"job_id": job_id, "source": payload.source},
        )

    return success(
        {
            "job_id": job_id,
            "status": "queued",
            "source": payload.source,
            "city_id": payload.city_id,
            "correlation_id": correlation_id,
        }
    )


# ---------------------------------------------------------------------------
# Outreach webhook
# POST /api/v1/scraping/outreach/webhook
# Called by Lambda:outreach-scheduler after sending WhatsApp to scraped provider.
# Updates outreach_schedule table status (to be implemented in full pipeline).
# ---------------------------------------------------------------------------
@app.post(
    "/api/v1/scraping/outreach/webhook",
    summary="Outreach status webhook from Lambda",
    status_code=status.HTTP_200_OK,
    tags=["Outreach"],
)
async def outreach_webhook(payload: OutreachWebhookPayload, request: Request) -> dict:
    """
    Receives status updates from Lambda:outreach-scheduler.
    Records whether each WhatsApp outreach attempt (1, 2 or 3) succeeded.

    Template sequence per MASTER_CONTEXT:
      Attempt 1 → provider_welcome
      Attempt 2 → activation_reminder_48h  (48h after attempt 1)
      Attempt 3 → provider_final_reminder_7d (7d after attempt 1)
    """
    correlation_id = (
        request.headers.get("X-Correlation-ID")
        or payload.correlation_id
        or str(uuid.uuid4())
    )

    valid_statuses = {"sent", "failed", "opted_out"}
    if payload.status not in valid_statuses:
        return error_response(
            "INVALID_OUTREACH_STATUS",
            f"status must be one of: {', '.join(valid_statuses)}",
        )

    logger.info(
        "Outreach webhook received",
        extra={
            "provider_id": payload.provider_id,
            "attempt": payload.attempt_number,
            "status": payload.status,
            "correlation_id": correlation_id,
        },
    )

    # TODO (Phase 3+): persist to outreach_schedule table via pg_loader
    # For now: acknowledge receipt — pipeline records will be written in a later session

    return success(
        {
            "received": True,
            "provider_id": payload.provider_id,
            "attempt_number": payload.attempt_number,
            "status": payload.status,
            "correlation_id": correlation_id,
        }
    )


# ---------------------------------------------------------------------------
# Scraping status endpoint
# GET /api/v1/scraping/jobs/{job_id}
# ---------------------------------------------------------------------------
@app.get(
    "/api/v1/scraping/jobs/{job_id}",
    summary="Get scraping job status",
    tags=["Scraping"],
)
async def get_job_status(job_id: str) -> dict:
    """
    Returns current status of a scraping job.
    TODO (Phase 3+): query scraping_jobs table in PostgreSQL.
    Currently returns a stub — job tracking to be implemented with pg_loader.
    """
    # Validate UUID format
    try:
        uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_JOB_ID", "message": "job_id must be a valid UUID"},
        )

    # Stub response — full implementation in Phase 3 (scraping pipeline session)
    return success(
        {
            "job_id": job_id,
            "status": "pending",
            "message": "Job status tracking will be available after Phase 3 pipeline implementation.",
        }
    )


# ---------------------------------------------------------------------------
# 404 handler — return standard SatvAAh error format
# ---------------------------------------------------------------------------
@app.exception_handler(404)
async def not_found_handler(request: Request, exc) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={
            "success": False,
            "error": {
                "code": "NOT_FOUND",
                "message": f"Route {request.method} {request.url.path} not found",
            },
        },
    )


# ---------------------------------------------------------------------------
# 500 handler
# ---------------------------------------------------------------------------
@app.exception_handler(500)
async def server_error_handler(request: Request, exc: Exception) -> JSONResponse:
    correlation_id = request.headers.get("X-Correlation-ID", "unknown")
    logger.error(
        "Unhandled exception",
        exc_info=exc,
        extra={"correlation_id": correlation_id, "path": str(request.url.path)},
    )
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred.",
            },
        },
    )
