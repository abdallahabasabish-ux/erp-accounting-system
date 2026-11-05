# صورة إنتاج خفيفة للنشر على أي PaaS أو VPS
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# الاعتماديات فقط (طبقة كاش)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# الكود
COPY src ./src
COPY schemas ./schemas
COPY firestore.rules firestore.indexes.json ./

# مستخدم غير جذري
RUN addgroup -S erp && adduser -S erp -G erp && chown -R erp:erp /app
USER erp

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT:-4000}/api/health || exit 1

CMD ["node", "src/index.js"]
