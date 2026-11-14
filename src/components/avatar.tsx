"use client";

import { avatarColor, cn, initials } from "@/lib/utils";

/** Avatar de contacto: iniciales sobre color estable (FR-006). */
export function ContactAvatar({
  name,
  seed,
  src,
  size = "md",
}: {
  name: string;
  /** Semilla del color (id o teléfono): estable para el mismo contacto. */
  seed: string;
  /** Foto real do contato, quando o canal disponibiliza. */
  src?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-7 w-7 text-[10px]",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
  } as const;
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white",
        sizes[size],
        avatarColor(seed)
      )}
      aria-label={src ? `Foto de ${name}` : undefined}
      aria-hidden={src ? undefined : true}
    >
      {initials(name)}
      {src && (
        // A URL vem do próprio WhatsApp e pode expirar; se falhar, ficam as iniciais.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      )}
    </span>
  );
}
