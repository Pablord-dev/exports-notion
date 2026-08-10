// Casos compartidos de la tabla `users`: los corre users.memory.test.ts contra el
// memory-store y db.pg.test.ts contra Postgres real. Si ambos pasan, el stub es
// fiel al SQL (misma lección D1 que reportCases.ts).
import { expect } from "vitest";

type Db = typeof import("@/lib/db");

export async function runUserAssertions(db: Db) {
  // Primer login: la fila nace con el rol menos privilegiado.
  await db.recordLogin("Pablo@Hiuman.edu.mx", "Pablo");
  // Y se guardó normalizada: la consulta en minúsculas encuentra esa misma fila.
  expect(await db.getUserRole("pablo@hiuman.edu.mx")).toBe("viewer");

  // Promoción. Un login posterior refresca la visita pero NO pisa el rol: si el
  // upsert tocara `role`, cada vez que un admin entrara volvería a ser viewer.
  await db.setUserRole("pablo@hiuman.edu.mx", "admin");
  await db.recordLogin("PABLO@hiuman.edu.mx", "Pablo Sánchez");
  expect(await db.getUserRole("pablo@hiuman.edu.mx")).toBe("admin");

  // Degradación: el script tiene que poder ir en las dos direcciones.
  await db.setUserRole("pablo@hiuman.edu.mx", "viewer");
  expect(await db.getUserRole("pablo@hiuman.edu.mx")).toBe("viewer");

  // Quien nunca entró no tiene fila. Devuelve null y lo resuelve roleOrDefault.
  expect(await db.getUserRole("nadie@hiuman.edu.mx")).toBeNull();

  // setUserRole sobre alguien que todavía no entró crea la fila: permite dejar
  // listo a un admin antes de su primer login.
  await db.setUserRole("Futuro@hiuman.edu.mx", "admin");
  expect(await db.getUserRole("futuro@hiuman.edu.mx")).toBe("admin");
}
