# Manual de usuario — ExportNotion

App pública: **https://iu-exports-notion.vercel.app/**

ExportNotion es una webapp para **consultar reportes y exportar CSV** de bases de datos de Notion. Mantiene una copia diaria de cada base en un cache rápido, así no esperas a que Notion responda. Hoy incluye la base `BD Tiempos`; el menú principal está pensado para ir sumando más bases.

---

## 1. Entrar

Abre **https://iu-exports-notion.vercel.app/**. Vas a ver la pantalla de login:

![Pantalla de login](./manual-screenshots/01-login.png)

**Qué hacer:**

1. Escribe la contraseña en el campo "Contraseña".
2. Pulsa **Entrar**. El botón cambia a "Entrando…" mientras valida.

> 💡 La contraseña se la pides al administrador. No hay registro: hay una sola contraseña compartida.

> ⚠️ Si fallas 5 intentos seguidos, la app te bloquea por 15 minutos desde tu IP. Es protección contra ataques de fuerza bruta.

---

## 2. Menú principal

Tras un login correcto verás el menú principal con las bases de datos disponibles:

![Menú principal](./manual-screenshots/08-menu-principal.png)

Cada tarjeta muestra el nombre de la base, cuántos registros hay en cache y hace cuánto fue la última sincronización, con dos accesos:

- **Reportes**: abre la vista de análisis de horas (sección 7).
- **Exportar y sincronizar**: abre el dashboard de la base (sección 3).

### Barra lateral

A la izquierda está la barra de navegación, disponible en todas las pantallas. Desde ahí puedes saltar entre el menú principal, los reportes y el dashboard de cada base, y **Cerrar sesión** (abajo).

- El **pin** (arriba a la derecha de la barra) la **ancla o desancla**: anclada queda fija y el contenido se acomoda a su lado; desanclada se esconde y aparece un botón ☰ arriba a la izquierda que la abre flotando sobre la página.
- La preferencia se recuerda en tu navegador.
- En pantallas chicas (móvil) siempre se comporta como flotante: ábrela con ☰ y ciérrala tocando fuera, con la ✕ o al navegar.

---

## 3. Dashboard de BD Tiempos

Al entrar con **Exportar y sincronizar** verás el panel de la base. Las tres secciones son independientes:

![Dashboard principal](./manual-screenshots/02-dashboard.png)

### (A) Cabecera

- **"BD Tiempos"**: la base en la que estás. Para regresar al menú o ir a los reportes usa la barra lateral.

### (B) Última sincronización

Resumen del estado del cache:

- **Full: hace X**: cuándo se completó la última sincronización completa (descarga todo desde Notion).
- **Incremental: hace X**: cuándo se completó el último refresco rápido (solo trae lo que cambió).
- **Registros en cache**: cuántas filas hay listas para descargar (en la captura, 18,117).

### (C) Próximas sincronizaciones

- **Incremental en HH:MM:SS**: cuenta regresiva al próximo refresco automático (21:00 UTC todos los días).
- **Full en HH:MM:SS**: cuenta regresiva al próximo full automático (09:00 UTC todos los días).
- **Refrescar incremental**: dispara una sincronización rápida AHORA, sin esperar al cron. Solo trae cambios recientes (~5–15 s).
- **Full**: descarga todo desde Notion ahora (~70 s o más). Úsalo si crees que faltan registros, no si solo quieres lo último.

### (D) Descargar CSV

- **Desde / Hasta**: rango opcional de fechas. El filtro es por la columna `Hora de creación`. Si dejas ambos vacíos, descargas TODO el cache.
- **Descargar**: genera y baja el CSV con el nombre `export-<desde>-<hasta>-<timestamp>.csv`.

---

## 4. Descargar un CSV

### Sin filtro (todo)

1. Asegúrate de que **Registros en cache** sea mayor a 0.
2. Deja los campos **Desde** y **Hasta** vacíos.
3. Pulsa **Descargar**. El botón cambia a "Descargando…" mientras el server prepara el archivo. Cuando termina, el navegador inicia la descarga automática.

### Con rango de fechas

![Descarga con rango](./manual-screenshots/05-descarga-rango.png)

1. Pon una fecha en **Desde** (ej. `2026-05-01`). Solo se incluirán registros creados en o después de esa fecha.
2. Pon una fecha en **Hasta** (ej. `2026-05-18`). Solo se incluirán registros creados en o antes de esa fecha.
3. Puedes dejar uno de los dos vacío:
   - Solo **Desde** = "desde esa fecha hasta hoy".
   - Solo **Hasta** = "desde el principio hasta esa fecha".
4. Pulsa **Descargar**.

**Formato del CSV:**

- Encoding: UTF-8.
- Una fila por registro de Notion.
- Columnas (21 en este orden): `Breve descripción`, `Empresa productiva`, `Hecho por`, `Hecho por (no tocar)`, `Hito`, `Hito (no tocar)`, `Hora de creación`, `Hora de finalización`, `Hora de última edición`, `ID`, `Persona`, `Proyecto`, `Proyecto (no tocar)`, `Registro de horas`, `Subproyecto`, `Subproyecto (Nombre)`, `Subproyecto (no tocar)`, `Tarea`, `Tarea (no tocar)`, `Último editor`, `Validación`.
- Orden de filas: **ascendente por `Hora de creación`** (las más viejas primero).

---

## 5. Sincronizar manualmente

Aunque la app sincroniza sola dos veces al día, a veces necesitas refrescar al momento.

### Incremental (rápido)

Úsalo cuando:

- Acabas de editar algo en Notion y quieres verlo reflejado ya.
- No estás seguro de si los cambios recientes están en el cache.

**Cómo:**

1. Pulsa **Refrescar incremental**.
2. El botón cambia a "Iniciando…" mientras arranca:

   ![Botón iniciando](./manual-screenshots/03-iniciando.png)

3. Recarga la página después de 10–20 segundos para ver el `Registros en cache` y el `Incremental: hace X` actualizados.

### Full (completo)

Úsalo cuando:

- El número de **Registros en cache** parece más bajo de lo esperado.
- Borraste/archivaste muchos registros en Notion y no se reflejan.
- Hubo un cron fallido (revisa con el admin si hay dudas).

**Cómo:**

1. Pulsa **Full**.
2. El botón cambia a "Iniciando…":

   ![Full iniciando](./manual-screenshots/04-sync-running.png)

3. Espera entre **1 y 3 minutos**. Recarga la página para ver el progreso.
4. Cuando termine, **Registros en cache** se actualiza y **Full: hace X** marca el nuevo timestamp.

> ⚠️ Mientras un sync está corriendo, ambos botones (Incremental y Full) están deshabilitados. No puedes lanzar dos a la vez.

---

## 6. Cancelar un sync en curso

Si un Full está corriendo y necesitas detenerlo sin perder lo que ya descargó, aparece un botón **Cancelar y guardar lo cargado** mientras está activo.

**Cómo:**

1. Mientras veas "Sync en progreso" en la UI, pulsa **Cancelar y guardar lo cargado**.
2. El sync corta en el siguiente punto seguro y guarda en el cache **solo lo que alcanzó a descargar** (ej. 8,000 de 18,000).
3. El próximo Full (manual o programado) repondrá el faltante.

> ⚠️ Después de cancelar, el `Registros en cache` puede bajar temporalmente. No es bug — es lo que pediste.

---

## 7. Consultar reportes

Desde el menú principal pulsa **Reportes** en la tarjeta de la base (o en la barra lateral) para abrir la vista de análisis de horas:

![Página de reportes](./manual-screenshots/06-reportes.png)

**Qué muestra:**

- **Totales del rango** — horas registradas, número de registros y personas activas con los filtros aplicados.
- **Evolución de horas** — gráfica por **Semana** o **Mes** (botones arriba a la derecha de la gráfica). Pasa el mouse sobre una barra para ver el detalle del periodo.
- **Horas por persona** y **Horas por subproyecto** — tablas ordenadas de mayor a menor.

**Filtros (se combinan entre sí):**

1. **Desde / Hasta** — rango de fechas; al abrir viene el mes en curso.
2. **Persona, Subproyecto, Proyecto, Empresa** — cada botón abre una lista con buscador donde puedes marcar varias opciones. El número azul indica cuántas hay seleccionadas; "Limpiar selección" las quita.

**Ver los registros detrás de un número (drill-down):**

- Haz click en una **fila** de cualquiera de las dos tablas, o en una **barra** de la gráfica.
- Se abre un panel con los registros individuales (ID, fecha, persona, tarea, descripción y horas). Si hay más de 50, aparece **Cargar más** al final.

![Detalle de registros](./manual-screenshots/07-reporte-detalle.png)

> 💡 La fila *(sin subproyecto)* agrupa los registros que no tienen subproyecto en Notion; por ahora no tiene detalle clickeable.

---

## 8. Cerrar sesión

Pulsa **Cerrar sesión** (abajo en la barra lateral). El botón muestra "Saliendo…" mientras procesa y luego te regresa a la pantalla de login.

> 💡 Cerrar sesión es opcional — la cookie de sesión expira sola tras un tiempo de inactividad. Úsalo si compartes la computadora.

---

## 9. Problemas comunes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| "Contraseña incorrecta" tras intentos válidos | Demasiados intentos: estás rate-limited (5 / 15 min por IP) | Esperar 15 minutos o pedir al admin que limpie la tabla `login_attempts` en Postgres |
| Botón Descargar → "Error 503: Aún no hay datos. Corre el primer sync." | Cache vacío | Pulsa **Full** y espera ~2 min |
| `Registros en cache: 0` justo después de cancelar un sync | Cancelaste antes de que se descargara la primera página | Vuelve a disparar **Full** y déjalo correr |
| Descarga vacía con un rango de fechas | No hay registros en ese rango | Quita las fechas o amplía el rango |
| Las cuentas regresivas no avanzan | La app no está cargando estado | Refresca la página (F5) |
| El sync se queda "trabado" mucho tiempo | Vercel cortó la función (timeout) | Espera 10 minutos a que se libere el lock, luego vuelve a disparar |

Si nada de lo anterior funciona, contacta al administrador con un screenshot del problema.

---

## 10. Calendario de sincronizaciones automáticas

| Tipo | Horario UTC | Horario CDMX (UTC−6) | Qué hace |
|---|---|---|---|
| Full | 09:00 | 03:00 | Reemplaza completamente el cache con lo que hay en Notion |
| Incremental | 21:00 | 15:00 | Solo trae los registros modificados desde el último sync |

Estos crons corren solos en Vercel; no necesitas hacer nada para que se ejecuten.
