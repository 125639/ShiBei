import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/member-auth";

export const dynamic = "force-dynamic";

// 未登录返回 200 + member:null（而非 401）：
// 前台 AccountClient 把「未登录」当正常状态渲染登录表单，
// 401 会被 requestJson 当异常抛出，登录页反而显示成错误。
export async function GET() {
  const member = await getCurrentMember();
  return NextResponse.json({ member });
}
