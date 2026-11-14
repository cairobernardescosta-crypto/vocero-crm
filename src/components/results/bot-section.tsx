"use client";

import type { BotBlockDto } from "@/lib/analytics";
import { BarChart } from "./bar-chart";
import { Rate, Section, Subhead } from "./section";
import { RateCard, StatCard } from "./stat-card";

/**
 * 019 — El trabajo del agente: si contesta, qué tan rápido, cuándo pasa a un
 * humano y —con la agenda encendida— cómo salen las citas. Todo sobre las
 * conversaciones que empezaron en el periodo, sin las del Laboratorio.
 */
export function BotSection({
  data,
  loading,
  error,
  agenda,
}: {
  data: BotBlockDto | null;
  loading: boolean;
  error: string | null;
  /** 015 — Sin la bandera AGENDA no se habla de citas en ningún lado. */
  agenda: boolean;
}) {
  return (
    <Section
      id="agente"
      title="O agente"
      hint={
        agenda
          ? "Se responde, com que rapidez, quando transfere para uma pessoa e como ficam os agendamentos."
          : "Se responde, em quanto tempo e quando transfere a conversa para uma pessoa."
      }
      loading={loading}
      error={error}
      hasData={!!data}
      empty={!!data?.empty}
      emptyText="Ainda não há conversas neste período."
    >
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            <StatCard label="Novas conversas" value={String(data.conversations)} />
            <RateCard
              label="O agente respondeu"
              rate={data.aiReplyRate}
              unit="com mensagem do cliente"
            />
            <StatCard
              label="Primeira resposta"
              value={
                data.firstResponseSeconds === null
                  ? "—"
                  : formatSegundos(data.firstResponseSeconds)
              }
              hint={
                data.firstResponseSample === 0
                  ? "o agente ainda não respondeu a ninguém"
                  : `mediana de ${data.firstResponseSample} conversas`
              }
            />
            <RateCard
              label="Transferidas para uma pessoa"
              rate={data.handoffRate}
              unit="conversas"
            />
          </div>

          {agenda && data.sessions && (
            <div>
              <Subhead>Agendamentos do período</Subhead>
              {data.sessions.booked === 0 ? (
                <p className="text-sm text-text-3">Nenhum agendamento neste período.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
                  <StatCard
                    label="Agendamentos"
                    value={String(data.sessions.booked)}
                    hint={pendientes(data.sessions)}
                  />
                  <StatCard label="Realizadas" value={String(data.sessions.done)} />
                  <StatCard label="Não compareceram" value={String(data.sessions.noShow)} />
                  <StatCard label="Canceladas" value={String(data.sessions.cancelled)} />
                  <RateCard
                    label="Comparecimento"
                    rate={data.sessions.showRate}
                    unit="com resultado"
                  />
                </div>
              )}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <Subhead>Por que foi transferida para uma pessoa</Subhead>
              <BarChart
                items={data.handoffs}
                emptyText="Nenhuma conversa do período foi transferida para uma pessoa."
              />
            </div>

            <div>
              <Subhead>Ficha do prospecto</Subhead>
              {data.fichaCoverage === null ? (
                // `null` NO es 0 %: es que el agente de esta instancia no escribe
                // ficha. Enseñar 0 % sería acusarlo de no hacer algo que nunca se
                // le pidió.
                <p className="text-sm text-text-3">
                  Ninguém está preenchendo a ficha dos prospectos. Ela pode ser preenchida por um cérebro
                  externo (<code className="font-mono text-xs">PUT /api/bot/ficha</code>) ou
                  pela sua equipe no painel da conversa.
                </p>
              ) : (
                <>
                  <p className="text-sm">
                    <Rate rate={data.fichaCoverage} unit="novos contatos" />
                  </p>
                  <p className="mt-1 text-xs text-text-3">
                    Dos contatos que chegaram neste período, quantos tiveram dados coletados.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Las citas del periodo que todavía no tienen desenlace (siguen agendadas). */
function pendientes(s: NonNullable<BotBlockDto["sessions"]>): string | undefined {
  const n = s.booked - s.done - s.noShow - s.cancelled;
  if (n <= 0) return undefined;
  return n === 1 ? "1 ainda sem resultado" : `${n} ainda sem resultado`;
}

/** Segundos en algo que se lee de un vistazo. */
export function formatSegundos(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round((s / 3600) * 10) / 10} h`;
}
