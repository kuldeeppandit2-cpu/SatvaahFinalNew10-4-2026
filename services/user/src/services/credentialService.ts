/**
 * Credential Service
 * Generates S3 pre-signed PUT URLs for provider credential uploads.
 * Credentials are stored in S3; admin reviews via admin portal.
 * S3 key schema: credentials/{provider_id}/{credential_type}/{timestamp}-{uuid}.{ext}
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl }               from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 }               from 'uuid';
import { prisma }                     from '@satvaaah/db';
import { logger }                     from '@satvaaah/logger';
import { NotFoundError, ValidationError } from '@satvaaah/errors';

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' });

const BUCKET         = process.env.S3_DOCUMENTS_BUCKET ?? 'satvaaah-documents';
const URL_EXPIRY_SEC = 600;   // 10 minutes

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg':       'jpg',
  'image/png':        'png',
  'image/webp':       'webp',
  'application/pdf':  'pdf',
};

const VALID_CREDENTIAL_TYPES = [
  'business_registration',
  'trade_licence',
  'medical_registration',
  'legal_bar_enrolment',
  'ca_icai_certificate',
  'architect_coa',
  'sebi_ria_certificate',
  'irdai_licence',
  'food_licence',
  'electrical_licence',
  'professional_certificate',
  'other',
] as const;

interface UploadUrlInput {
  userId:          string;
  credentialType: string;
  fileName:       string;
  contentType:    string;
  correlationId:   string;
}

interface UploadUrlResult {
  uploadUrl:  string;
  s3Key:      string;
  expiresIn:  number;
}

async function generateUploadUrl(input: UploadUrlInput): Promise<UploadUrlResult> {
  const { userId, credentialType, fileName, contentType, correlationId } = input;

  if (!VALID_CREDENTIAL_TYPES.includes(credentialType as any)) {
    throw new ValidationError(
      'INVALID_CREDENTIAL_TYPE',
      `credentialType must be one of: ${VALID_CREDENTIAL_TYPES.join(', ')}`
    );
  }

  const provider = await prisma.providerProfile.findUnique({ where: { user_id: userId } });
  if (!provider) throw new NotFoundError('PROVIDER_NOT_FOUND', 'Create a provider profile first');

  // Sanitise file name — strip path traversal attempts
  const safeName     = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  const ext          = CONTENT_TYPE_TO_EXT[contentType] ?? 'bin';
  const timestamp    = Date.now();
  const uniqueId     = uuidv4();

  const s3Key = `credentials/${provider.id}/${credentialType}/${timestamp}-${uniqueId}-${safeName}.${ext}`;

  const command = new PutObjectCommand({
    Bucket:             BUCKET,
    Key:                s3Key,
    ContentType:        contentType,
    Metadata: {
      provider_id:      provider.id,
      credentialType,
      correlationId,
      originalName:  safeName,
    },
    // Server-side encryption
    ServerSideEncryption: 'AES256',
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: URL_EXPIRY_SEC });

  // Insert credential record with status=pending_review
  const credential = await prisma.providerVerification.create({
    data: {
      provider_id:       provider.id,
      verification_type: credentialType,
      status:           'pending',
      // S3 key stored in credential_name field per schema
      credential_name:   safeName,
    },
    select: { id: true, status: true, created_at: true },
  });

  logger.info('Credential pre-signed URL generated');

  return {
    uploadUrl,
    s3Key,
    expiresIn: URL_EXPIRY_SEC,
  };
}

export const credentialService = { generateUploadUrl };

// ─── getPresignedUploadUrl — returns S3 pre-signed URL for mobile credential upload ──
export async function getPresignedUploadUrl(params: {
  userId: string;
  fileType: string;
  credentialType: string;
  correlationId: string;
}): Promise<{ uploadUrl: string; s3Key: string; expiresIn: number }> {
  const { userId, fileType, credentialType } = params;
  const ext = fileType.split('/')[1] ?? 'bin';
  const s3Key = `credentials/${userId}/${credentialType}/${Date.now()}.${ext}`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: process.env.S3_DOCUMENTS_BUCKET ?? '', Key: s3Key, ContentType: fileType }),
    { expiresIn: URL_EXPIRY_SEC }
  );
  return { uploadUrl, s3Key, expiresIn: URL_EXPIRY_SEC };
}
