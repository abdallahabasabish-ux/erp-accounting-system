/**
 * وسيط ERP — يمرر طلبات الواجهة إلى خادم المحاسبة (Express) عبر الخادم فقط:
 *   المتصفح → /api/erp/<مسار> → http://localhost:4000/api/<مسار>
 * فوائد هذا التصميم:
 * - لا CORS ولا تكشف عنوان الخادم المالي للعميل.
 * - في الإنتاج يُضبط ERP_API_URL على رابط خادم Render/Railway.
 * - رمز الدخول (Authorization) يمر شفافاً للخادم الذي يفحص الصلاحيات.
 */
import { NextRequest, NextResponse } from 'next/server';

const ERP_API_URL = process.env.ERP_API_URL || 'http://localhost:4000';

async function forward(req: NextRequest, params: { path: string[] }) {
  const target = `${ERP_API_URL}/api/${params.path.join('/')}${new URL(req.url).search}`;
  const headers = new Headers();
  const auth = req.headers.get('authorization');
  if (auth) headers.set('authorization', auth);
  headers.set('content-type', 'application/json');

  try {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text();
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'ERP_UNREACHABLE', message: 'تعذر الوصول إلى خادم المحاسبة — تأكد من تشغيله' } },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, await ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, await ctx.params);
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, await ctx.params);
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, await ctx.params);
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, await ctx.params);
}
