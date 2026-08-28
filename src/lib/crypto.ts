import crypto from "node:crypto";

let warnedAboutFallbackKey = false;

function getKey() {
  const explicit = process.env.ENCRYPTION_KEY;
  if (explicit) return crypto.createHash("sha256").update(explicit).digest();

  const fallback = process.env.AUTH_SECRET;
  if (fallback) {
    // 回落可用，但要说清代价：AUTH_SECRET 还兼着会话签名。为吊销全部会话而
    // 轮换它，会连带把所有已加密字段（模型 API Key、Exa Key、SYNC_TOKEN、
    // yt-dlp cookies）变成无法解密的密文——且失败发生在轮换之后，很难联想到原因。
    if (!warnedAboutFallbackKey) {
      warnedAboutFallbackKey = true;
      console.warn(
        "[crypto] 未配置 ENCRYPTION_KEY，正在回落使用 AUTH_SECRET 派生密钥。" +
          "二者共用意味着轮换 AUTH_SECRET（例如为了吊销所有会话）会让已加密的" +
          "模型 API Key / Exa Key / SYNC_TOKEN 全部无法解密。请单独设置 ENCRYPTION_KEY。"
      );
    }
    return crypto.createHash("sha256").update(fallback).digest();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY/AUTH_SECRET 未配置：拒绝在生产环境用兜底密钥加密敏感字段（一旦密钥公开，所有已加密 secret 都可被解出）。");
  }
  return crypto.createHash("sha256").update("dev-secret-change-me").digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(value: string) {
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Invalid encrypted secret");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}
