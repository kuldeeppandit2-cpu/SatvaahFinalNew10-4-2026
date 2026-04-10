/**
 * lambdas/certificate-generator/index.ts
 * Trigger: SQS — certificate-generator queue (from trust-recalculate when score crosses 80)
 * Purpose: Issue Certificate of Verification — EXACTLY ONCE per provider lifetime.
 *          Idempotency via certificate_records (provider_id UNIQUE).
 *          PDF via PDFKit. Upload to S3. FCM push + WhatsApp.
 * Cert ID: SAT-{CITY_CODE}-{YEAR}-{5DIGIT_SEQ}
 * S3 key:  certificates/{city_id}/{provider_id}/{certId}.pdf
 */

import { SQSEvent, SQSRecord, SQSBatchItemFailure, SQSBatchResponse } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import * as admin from 'firebase-admin';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import https from 'https';

const prisma   = new PrismaClient();
const s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' });

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID ?? '',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    }),
  });
}
const fcm = admin.messaging();

const BRAND = { saffron: '#C8691A', deepInk: '#1C1C2E', ivory: '#FAF7F0', verdigris: '#2E7D72', warmSand: '#F0E4CC' };

interface CertificateMessage {
  provider_id:    string;
  correlation_id: string;
  display_score:  number;
  triggered_at:   string;
}

async function nextCertSeq(tx: any): Promise<string> {
  // Use a simple counter in system_config as sequence (no PostgreSQL sequence needed)
  const row = await tx.$queryRaw<[{ nextval: bigint }]>`
    SELECT nextval('certificate_id_seq') AS nextval
  `;
  return Number(row[0].nextval).toString().padStart(5, '0');
}

async function generateQR(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { errorCorrectionLevel: 'M', type: 'png', width: 180, margin: 1,
    color: { dark: BRAND.deepInk, light: BRAND.ivory } });
}

async function generatePDF(providerName: string, categoryName: string, cityName: string,
  trustScore: number, certId: string, verifyUrl: string, qrBuffer: Buffer, issuedAt: Date): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width, H = doc.page.height;
    doc.rect(0, 0, W, H).fill(BRAND.ivory);
    doc.rect(0, 0, W, 10).fill(BRAND.verdigris);
    doc.rect(24, 24, W - 48, H - 48).lineWidth(2).stroke(BRAND.saffron);
    doc.font('Helvetica-Bold').fontSize(28).fillColor(BRAND.verdigris).text('SatvAAh', 0, 56, { align: 'center' });
    doc.font('Helvetica').fontSize(11).fillColor(BRAND.deepInk).text('Truth that travels.', 0, 92, { align: 'center' });
    doc.moveTo(60, 118).lineTo(W - 60, 118).lineWidth(1).stroke(BRAND.saffron);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND.deepInk).text('CERTIFICATE OF VERIFICATION', 0, 136, { align: 'center' });
    doc.font('Helvetica').fontSize(11).text('This certifies that the following service provider has been verified', 0, 164, { align: 'center' });
    doc.text('by SatvAAh and meets our trust standards.', 0, 180, { align: 'center' });
    doc.font('Helvetica-Bold').fontSize(22).fillColor(BRAND.verdigris).text(providerName, 0, 218, { align: 'center' });

    const detailY = 262, labelX = 100, valueX = 280;
    [['Category', categoryName], ['City', cityName], ['Trust Score', `${trustScore} / 100`],
     ['Status', 'Highly Trusted ✓'],
     ['Issued On', issuedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })]]
    .forEach(([label, value], i) => {
      const y = detailY + i * 26;
      doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND.deepInk).text(`${label}:`, labelX, y);
      doc.font('Helvetica').fontSize(11).text(value, valueX, y);
    });

    const boxY = detailY + 5 * 26 + 16;
    doc.rect(60, boxY, W - 120, 36).fill(BRAND.warmSand);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(BRAND.deepInk).text(`Certificate ID: ${certId}`, 0, boxY + 11, { align: 'center' });

    const qrY = boxY + 56;
    doc.image(qrBuffer, W / 2 - 70, qrY, { width: 140, height: 140 });
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.deepInk).text('Scan to verify', 0, qrY + 146, { align: 'center' });
    doc.fillColor(BRAND.saffron).text(verifyUrl, 0, qrY + 160, { align: 'center', link: verifyUrl });

    doc.moveTo(60, H - 72).lineTo(W - 60, H - 72).lineWidth(1).stroke(BRAND.saffron);
    doc.font('Helvetica').fontSize(8).fillColor(BRAND.deepInk)
      .text('SatvAAh Technologies | F-126, Suncity, Gurgaon 122011 | satvaaah.com', 0, H - 58, { align: 'center' })
      .text('This certificate is auto-generated and digitally verifiable.', 0, H - 44, { align: 'center' });
    doc.rect(0, H - 10, W, 10).fill(BRAND.verdigris);
    doc.end();
  });
}

async function sendFCM(fcmToken: string, certId: string, providerId: string, verifyUrl: string): Promise<void> {
  await fcm.send({
    token: fcmToken,
    notification: { title: '🏅 Certificate of Verification earned!', body: 'Your trust score reached Highly Trusted. Download your certificate.' },
    data: { eventType: 'certificate_issued', cert_id: certId, provider_id: providerId, verify_url: verifyUrl, deep_link: `satvaaah://provider/${providerId}` },
    android: { priority: 'high', notification: { channelId: 'trust_events', icon: 'ic_certificate' } },
    apns: { payload: { aps: { badge: 1, sound: 'default' } } },
  });
}

async function sendWhatsApp(phone: string, name: string, certId: string, verifyUrl: string): Promise<void> {
  const body = new URLSearchParams({
    channel: 'whatsapp', source: process.env.GUPSHUP_WHATSAPP_NUMBER ?? '',
    destination: phone, 'src.name': 'SatvAAh',
    message: JSON.stringify({ type: 'template', template: { id: 'certificate_ready', params: [name, certId, verifyUrl] } }),
  }).toString();

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      { hostname: 'api.gupshup.io', path: '/sm/api/v1/msg', method: 'POST',
        headers: { apikey: process.env.GUPSHUP_API_KEY ?? '', 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
      res => { res.resume(); res.statusCode && res.statusCode < 400 ? resolve() : reject(new Error(`Gupshup HTTP ${res.statusCode}`)); },
    );
    req.on('error', reject); req.write(body); req.end();
  });
}

async function generateCertificate(msg: CertificateMessage): Promise<void> {
  const { provider_id: providerId, correlation_id: correlationId, display_score: displayScore } = msg;
  const log = (m: string, extra?: object) => console.log(JSON.stringify({ level: 'info', lambda: 'certificate-generator', provider_id: providerId, correlation_id: correlationId, m, ...extra }));

  // IDEMPOTENCY — abort if already issued
  const existing = await prisma.certificateRecord.findUnique({ where: { provider_id: providerId }, select: { certificate_id: true } });
  if (existing) { log('Already issued — skipping', { cert_id: existing.certificate_id }); return; }

  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { id: true, user_id: true, display_name: true, listing_type: true, city_id: true, taxonomy_node_id: true },
  });
  if (!provider) throw new Error(`Provider not found: ${providerId}`);

  const user = await prisma.user.findUnique({ where: { id: provider.user_id! }, select: { phone: true, fcm_token: true, wa_opted_out: true } });
  if (!user) throw new Error(`User not found: ${provider.user_id}`);

  const city = await prisma.city.findUnique({ where: { id: provider.city_id }, select: { name: true, slug: true } });
  if (!city) throw new Error(`City not found: ${provider.city_id}`);

  const taxNode = provider.taxonomy_node_id
    ? await prisma.taxonomyNode.findUnique({ where: { id: provider.taxonomy_node_id }, select: { display_name: true } })
    : null;

  // City code: first 3 chars of slug uppercase (slug = 'hyderabad' → 'HYD')
  const cityCode   = city.slug.slice(0, 3).toUpperCase();
  const year       = new Date().getFullYear().toString();
  const issuedAt   = new Date();
  const categoryName = taxNode?.display_name ?? provider.listing_type;
  const providerName = provider.display_name ?? 'Service Provider';

  // Generate cert sequence number
  const seqStr = await prisma.$transaction(async tx => nextCertSeq(tx));
  const certId   = `SAT-${cityCode}-${year}-${seqStr}`;
  const verifyUrl = `https://satvaaah.com/verify/${certId}`;

  log('Generating PDF', { certId });
  const qrBuffer  = await generateQR(verifyUrl);
  const pdfBuffer = await generatePDF(providerName, categoryName, city.name, displayScore, certId, verifyUrl, qrBuffer, issuedAt);

  const s3Key = `certificates/${provider.city_id}/${providerId}/${certId}.pdf`;
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.S3_DOCUMENTS_BUCKET ?? '', Key: s3Key, Body: pdfBuffer,
    ContentType: 'application/pdf', CacheControl: 'public, max-age=31536000, immutable',
    Metadata: { 'cert-id': certId, 'provider-id': providerId },
  }));
  log('Uploaded to S3', { s3Key });

  const validUntil = new Date(); validUntil.setFullYear(validUntil.getFullYear() + 1);

  try {
    await prisma.certificateRecord.create({
      data: { provider_id: providerId, city_id: provider.city_id, certificate_id: certId, issued_at: issuedAt, valid_until: validUntil, s3_key: s3Key, verification_url: verifyUrl },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') { log('Race: concurrent Lambda already issued — skipping'); return; }
    throw err;
  }

  // FCM push
  if (user.fcm_token) {
    try { await sendFCM(user.fcm_token, certId, providerId, verifyUrl); log('FCM sent'); }
    catch (e) { console.warn(JSON.stringify({ level: 'warn', lambda: 'certificate-generator', msg: 'FCM failed', error: (e as Error).message })); }
  }

  // WhatsApp (extraordinary event — permitted)
  if (!user.wa_opted_out) {
    try { await sendWhatsApp(user.phone, providerName, certId, verifyUrl); log('WhatsApp sent'); }
    catch (e) { console.warn(JSON.stringify({ level: 'warn', lambda: 'certificate-generator', msg: 'WhatsApp failed', error: (e as Error).message })); }
  }

  log('Complete', { certId });
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: SQSBatchItemFailure[] = [];
  await Promise.all(event.Records.map(async (record: SQSRecord) => {
    try { await generateCertificate(JSON.parse(record.body) as CertificateMessage); }
    catch (err) {
      console.error(JSON.stringify({ level: 'error', lambda: 'certificate-generator', messageId: record.messageId, error: (err as Error).message }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }));
  return { batchItemFailures: failures };
};
