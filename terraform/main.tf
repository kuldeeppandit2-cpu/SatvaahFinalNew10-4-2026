# terraform/main.tf
# SatvAAh AWS Infrastructure — ap-south-1
# Rating Reminder Lambda + EventBridge hourly rule (item 26)

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "ap-south-1"
}

# ── IAM Role for rating-reminder Lambda ───────────────────────────────────────

resource "aws_iam_role" "rating_reminder_exec" {
  name = "satvaaah-rating-reminder-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rating_reminder_basic" {
  role       = aws_iam_role.rating_reminder_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── Lambda function ────────────────────────────────────────────────────────────

resource "aws_lambda_function" "rating_reminder" {
  function_name = "satvaaah-rating-reminder"
  role          = aws_iam_role.rating_reminder_exec.arn
  handler       = "dist/index.handler"
  runtime       = "nodejs20.x"
  timeout       = 300   # 5 min — enough for 500 FCM sends + DB update
  memory_size   = 256

  # Deployment package — built by CI: cd lambdas/rating-reminder && npm run build && zip
  filename         = "${path.module}/../lambdas/rating-reminder/dist.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/rating-reminder/dist.zip")

  environment {
    variables = {
      DATABASE_URL          = var.database_url
      FIREBASE_PROJECT_ID   = var.firebase_project_id
      FIREBASE_CLIENT_EMAIL = var.firebase_client_email
      FIREBASE_PRIVATE_KEY  = var.firebase_private_key
    }
  }
}

# ── EventBridge rule — hourly ──────────────────────────────────────────────────
# Fires every hour. Lambda queries the 23h–25h window so each event gets
# exactly one reminder regardless of which minute in the hour it was created.

resource "aws_cloudwatch_event_rule" "rating_reminder_schedule" {
  name                = "satvaaah-rating-reminder-hourly"
  description         = "Trigger rating-reminder Lambda every hour (item 26)"
  schedule_expression = "cron(0 * * * ? *)"   # every hour on the hour
  state               = "ENABLED"
}

resource "aws_cloudwatch_event_target" "rating_reminder_target" {
  rule      = aws_cloudwatch_event_rule.rating_reminder_schedule.name
  target_id = "rating-reminder-lambda"
  arn       = aws_lambda_function.rating_reminder.arn
}

resource "aws_lambda_permission" "allow_eventbridge_rating_reminder" {
  statement_id  = "AllowEventBridgeRatingReminder"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rating_reminder.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.rating_reminder_schedule.arn
}

# ── Variables ─────────────────────────────────────────────────────────────────

variable "database_url"          { type = string; sensitive = true }
variable "firebase_project_id"   { type = string }
variable "firebase_client_email" { type = string }
variable "firebase_private_key"  { type = string; sensitive = true }
