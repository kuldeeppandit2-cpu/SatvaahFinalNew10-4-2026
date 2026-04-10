# SatvAAh — Scraping Service
# Python 3.11 + Playwright for JS-rendered pages

FROM python:3.11-slim

WORKDIR /app

# System deps for Playwright / lxml / psycopg2
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    libxml2-dev \
    libxslt1-dev \
    curl \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Playwright browsers (Chromium only — smallest footprint)
RUN playwright install chromium --with-deps

# NLTK data
RUN python -c "import nltk; nltk.download('stopwords'); nltk.download('punkt')"

# App code
COPY . .

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "import requests; requests.get('http://localhost:8080/health', timeout=5)"

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8080

CMD ["python", "main.py"]
