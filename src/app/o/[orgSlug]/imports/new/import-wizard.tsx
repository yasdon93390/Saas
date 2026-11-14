"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CsvError, DELIMITER_LABELS, detectDelimiter, parseCsv, type CsvTable, type Delimiter } from "@/lib/csv";
import { DATE_FORMAT_LABELS, type DateFormat } from "@/lib/import/dates";
import {
  guessMapping,
  IMPORT_FIELDS,
  MAX_IMPORT_BYTES,
  type ColumnMapping,
  type ImportFieldKey,
} from "@/lib/import/invoices";
import type { DecimalStyle } from "@/lib/money";
import { checkImport, runImport, type ImportCheck } from "../actions";

const SELECT = "block h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm";
const STEPS = ["Fichier", "Colonnes", "Vérification"] as const;

const DECIMAL_LABELS: Record<DecimalStyle, string> = {
  auto: "Détection automatique (refuse les cas ambigus)",
  comma: "Virgule : 1 234,56",
  dot: "Point : 1,234.56",
};

/** Lit le fichier en UTF-8 ; s'il vient d'un ancien Excel, bascule sur Windows-1252. */
async function readText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

export function ImportWizard({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [delimiter, setDelimiter] = useState<Delimiter>(";");
  const [dateFormat, setDateFormat] = useState<DateFormat>("DMY");
  const [decimalStyle, setDecimalStyle] = useState<DecimalStyle>("auto");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [check, setCheck] = useState<Extract<ImportCheck, { ok: true }> | null>(null);

  const payload = () => ({ fileName, text, settings: { delimiter, dateFormat, decimalStyle, mapping } });

  function load(content: string, separator: Delimiter, keepMapping: boolean) {
    try {
      const parsed = parseCsv(content, separator);
      setTable(parsed);
      if (!keepMapping) setMapping(guessMapping(parsed.headers));
      setError(null);
      return true;
    } catch (cause) {
      setTable(null);
      setError(cause instanceof CsvError ? cause.message : "Fichier illisible.");
      return false;
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCheck(null);
    if (!/\.csv$/i.test(file.name)) return setError("Seuls les fichiers .csv sont acceptés.");
    if (file.size > MAX_IMPORT_BYTES) return setError("Le fichier dépasse 2 Mo. Découpez-le en plusieurs fichiers.");
    if (file.size === 0) return setError("Le fichier est vide.");

    const content = await readText(file);
    const separator = detectDelimiter(content);
    setFileName(file.name);
    setText(content);
    setDelimiter(separator);
    if (load(content, separator, false)) setStep(1);
  }

  function changeDelimiter(separator: Delimiter) {
    setDelimiter(separator);
    load(text, separator, false);
  }

  function verify() {
    setError(null);
    startTransition(async () => {
      const result = await checkImport(orgSlug, payload());
      if (!result.ok) return setError(result.error);
      setCheck(result);
      setStep(2);
    });
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await runImport(orgSlug, payload());
      if (!result.ok) return setError(result.error);
      router.push(`/o/${orgSlug}/imports/${result.batchId}`);
    });
  }

  const missing = IMPORT_FIELDS.filter((field) => field.required && !mapping[field.key]);

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Étapes de l'import">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={`rounded-full border px-3 py-1 ${
              index === step
                ? "border-action bg-action text-white"
                : index < step
                  ? "border-success/30 bg-success-soft text-success"
                  : "border-line bg-surface text-ink-faint"
            }`}
          >
            {index + 1}. {label}
            {index < step ? " — fait" : ""}
          </li>
        ))}
      </ol>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {step === 0 ? (
        <Card>
          <CardHeader
            title="Choisir le fichier"
            description="Un fichier CSV exporté de votre logiciel de facturation ou de votre tableur. 2 Mo et 5 000 lignes au maximum."
          />
          <CardBody className="space-y-4">
            <div>
              <label htmlFor="file" className="mb-1.5 block text-sm font-medium text-ink">
                Fichier CSV
              </label>
              <input
                id="file"
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                className="block w-full text-sm text-ink file:mr-4 file:rounded-lg file:border file:border-line file:bg-surface file:px-4 file:py-2 file:text-sm file:font-medium"
              />
            </div>
            <p className="text-sm text-ink-soft">
              Colonnes attendues : numéro de facture, client, date d&apos;émission, date d&apos;échéance, montant
              total. Facultatives : montant déjà payé, devise, email, identifiants externes. Rien n&apos;est
              enregistré avant votre confirmation à la dernière étape.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {step === 1 && table ? (
        <>
          <Card>
            <CardHeader title="Format du fichier" description={`${fileName} — ${table.rows.length} ligne(s) de données.`} />
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="delimiter" className="mb-1.5 block text-sm font-medium text-ink">
                  Séparateur de colonnes
                </label>
                <select id="delimiter" className={SELECT} value={delimiter} onChange={(e) => changeDelimiter(e.target.value as Delimiter)}>
                  {(Object.keys(DELIMITER_LABELS) as Delimiter[]).map((value) => (
                    <option key={value} value={value}>
                      {DELIMITER_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="dateFormat" className="mb-1.5 block text-sm font-medium text-ink">
                  Format des dates
                </label>
                <select id="dateFormat" className={SELECT} value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                  {(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map((value) => (
                    <option key={value} value={value}>
                      {DATE_FORMAT_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="decimalStyle" className="mb-1.5 block text-sm font-medium text-ink">
                  Séparateur décimal des montants
                </label>
                <select id="decimalStyle" className={SELECT} value={decimalStyle} onChange={(e) => setDecimalStyle(e.target.value as DecimalStyle)}>
                  {(Object.keys(DECIMAL_LABELS) as DecimalStyle[]).map((value) => (
                    <option key={value} value={value}>
                      {DECIMAL_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Correspondance des colonnes"
              description="Indiquez quelle colonne de votre fichier correspond à chaque information. Les champs marqués d'un astérisque sont obligatoires."
            />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <div key={field.key}>
                  <label htmlFor={`map-${field.key}`} className="mb-1.5 block text-sm font-medium text-ink">
                    {field.label}
                    {field.required ? " *" : ""}
                  </label>
                  <select
                    id={`map-${field.key}`}
                    className={SELECT}
                    value={mapping[field.key] ?? ""}
                    onChange={(e) =>
                      setMapping((current) => ({ ...current, [field.key as ImportFieldKey]: e.target.value || undefined }))
                    }
                  >
                    <option value="">— Aucune colonne —</option>
                    {table.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Aperçu" description="Les 5 premières lignes, telles que lues dans le fichier." />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Aperçu du fichier</caption>
                <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <tr>
                    {table.headers.map((header) => (
                      <th key={header} scope="col" className="whitespace-nowrap px-4 py-2 font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {table.rows.slice(0, 5).map((row) => (
                    <tr key={row.number}>
                      {table.headers.map((header, index) => (
                        <td key={header} className="whitespace-nowrap px-4 py-2 text-ink-soft">
                          {row.cells[index] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {missing.length > 0 ? (
            <Alert tone="info">
              Colonnes obligatoires à associer : {missing.map((field) => field.label).join(", ")}.
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button onClick={verify} disabled={pending || missing.length > 0} aria-busy={pending}>
              {pending ? "Vérification…" : "Vérifier le fichier"}
            </Button>
            <Button variant="secondary" onClick={() => setStep(0)} disabled={pending}>
              Changer de fichier
            </Button>
          </div>
        </>
      ) : null}

      {step === 2 && check ? (
        <>
          <Card>
            <CardHeader title="Résultat de la vérification" description="Rien n'a encore été enregistré." />
            <CardBody className="space-y-4">
              <dl className="grid gap-4 sm:grid-cols-3">
                {[
                  { label: "Lignes lues", value: check.totalRows },
                  { label: "Prêtes à importer", value: check.validCount },
                  { label: "Refusées", value: check.rejectedCount },
                ].map((figure) => (
                  <div key={figure.label} className="rounded-lg border border-line px-4 py-3">
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{figure.label}</dt>
                    <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{figure.value}</dd>
                  </div>
                ))}
              </dl>
              {check.alreadyImported ? (
                <Alert tone="info">
                  Ce fichier a déjà été importé à l&apos;identique. Vous pouvez le relancer sans risque : les
                  factures déjà présentes seront ignorées, aucun doublon ne sera créé.
                </Alert>
              ) : null}
              <p className="text-sm text-ink-soft">
                Les factures dont le numéro existe déjà dans votre organisation seront ignorées et signalées
                dans le rapport. Les clients inconnus seront créés.
              </p>
            </CardBody>
          </Card>

          {check.rejectedSample.length > 0 ? (
            <Card>
              <CardHeader
                title="Lignes refusées"
                description={
                  check.rejectedCount > check.rejectedSample.length
                    ? `Les ${check.rejectedSample.length} premières sur ${check.rejectedCount}. Le rapport complet sera téléchargeable après l'import.`
                    : "Ces lignes ne seront pas importées. Corrigez-les dans votre fichier puis réimportez-le : les autres ne seront pas dupliquées."
                }
              />
              <ul className="divide-y divide-line text-sm">
                {check.rejectedSample.map((row) => (
                  <li key={row.row_number} className="px-6 py-3">
                    <span className="font-medium text-ink">Ligne {row.row_number}</span>
                    <span className="text-ink-soft"> — {row.messages.join(" ")}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button onClick={confirm} disabled={pending || check.validCount === 0} aria-busy={pending}>
              {pending ? "Import en cours…" : `Importer ${check.validCount} facture(s)`}
            </Button>
            <Button variant="secondary" onClick={() => setStep(1)} disabled={pending}>
              Revenir aux colonnes
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
