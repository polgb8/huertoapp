// admin.js — Cuenta de administrador de la app. Solo ella ve el "Uso del plan
// gratuito" (la protección real está en migracion_v13_uso_admin.sql).
export const EMAIL_ADMIN = 'polgaba8@gmail.com';

export function esAdmin(email) {
  return (email || '').trim().toLowerCase() === EMAIL_ADMIN;
}
