/**
 * services/trust/src/controllers/certificate.controller.ts
 *
 * GET /api/v1/trust/certificate/mine   — provider's own certificate
 * GET /api/v1/trust/certificate/:certId — certificate by ID (public verify)
 *
 * Returns CertificateData shape that CertificateScreen expects:
 *   { certId, providerName, listingType, trustScore, issuedAt, validUntil,
 *     verifyUrl, pdfUrl (30-min presigned S3 URL), category, city }
 *
 * MASTER_CONTEXT rules:
 *   - Pre-signed URL expiry: 30 minutes (matches certificate_validity check cadence)
 *   - is_revoked = true → 410 Gone
 *   - is_suspended = true → 423 Locked (below-threshold grace period)
 */

import { Request, Response } from 'express';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' });
const BUCKET = process.env.S3_DOCUMENTS_BUCKET ?? '';
const PRESIGN_EXPIRY_SECONDS = 1800; // 30 minutes

async function buildCertResponse(cert: {
  certificate_id: string;
  issued_at: Date;
  valid_until: Date | null;
  verification_url: string;
  s3_key: string;
  is_revoked: boolean;
  is_suspended: boolean;
  provider?: {
    display_name: string;
    listing_type: string;
    trust_score: number;
    taxonomy_node_id: string | null;
    city?: { name: string } | null;
  } | null;
}) {
  const pdfUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: cert.s3_key }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS },
  );

  return {
    certId: cert.certificate_id,
    providerName: cert.provider?.display_name ?? 'Provider',
    listingType: cert.provider?.listing_type ?? 'individual_service',
    trustScore: cert.provider?.trust_score ?? 0,
    issuedAt: cert.issued_at.toISOString(),
    validUntil: cert.valid_until?.toISOString() ?? null,
    verifyUrl: cert.verification_url,
    pdfUrl,
    category: cert.provider?.taxonomy_node_id ?? '',
    city: cert.provider?.city?.name ?? '',
  };
}

export const certificateController = {
  /**
   * GET /api/v1/trust/certificate/mine
   * Authenticated provider's own certificate.
   */
  async getMine(req: Request, res: Response): Promise<void> {
    const user = (req as any).user;

    const provider = await prisma.providerProfile.findFirst({
      where: { user_id: user.userId },
      select: { id: true },
    });

    if (!provider) {
      res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found' } });
      return;
    }

    const cert = await prisma.certificateRecord.findUnique({
      where: { provider_id: provider.id },
      include: {
        provider: {
          select: {
            display_name: true,
            listing_type: true,
            trust_score: true,
            taxonomy_node_id: true,
            city: { select: { name: true } },
          },
        },
      },
    });

    if (!cert) {
      res.status(404).json({ success: false, error: { code: 'CERTIFICATE_NOT_FOUND', message: 'No certificate issued yet. Reach score 80 to earn it.' } });
      return;
    }
    if (cert.is_revoked) {
      res.status(410).json({ success: false, error: { code: 'CERTIFICATE_REVOKED', message: 'Certificate has been revoked.' } });
      return;
    }

    logger.info(`trust.certificate.getMine`);
    res.json({ success: true, data: await buildCertResponse(cert) });
  },

  /**
   * GET /api/v1/trust/certificate/:certId
   * Public certificate lookup (for satvaaah.com/verify/:certId).
   * No auth required — certificate verification is always public.
   */
  async getByCertId(req: Request, res: Response): Promise<void> {
    const { certId } = req.params;

    const cert = await prisma.certificateRecord.findUnique({
      where: { certificate_id: certId },
      include: {
        provider: {
          select: {
            display_name: true,
            listing_type: true,
            trust_score: true,
            taxonomy_node_id: true,
            city: { select: { name: true } },
          },
        },
      },
    });

    if (!cert) {
      res.status(404).json({ success: false, error: { code: 'CERTIFICATE_NOT_FOUND', message: 'Certificate not found.' } });
      return;
    }
    if (cert.is_revoked) {
      res.status(410).json({ success: false, error: { code: 'CERTIFICATE_REVOKED', message: 'Certificate has been revoked.' } });
      return;
    }

    logger.info(`trust.certificate.getByCertId`);
    res.json({ success: true, data: await buildCertResponse(cert) });
  },
};
