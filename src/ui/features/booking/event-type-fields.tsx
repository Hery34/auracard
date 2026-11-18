import {
  DEFAULT_MIN_NOTICE_MIN,
  EVENT_TYPE_BOUNDS,
  EVENT_TYPE_TITLE_MAX_LENGTH,
  LOCATION_KINDS,
  LOCATION_TEXT_MAX_LENGTH,
  type EventTypeDraft,
  type EventTypeField,
} from "@/domain/booking/event-type";
import { LOCATION_KIND_LABELS } from "@/ui/features/booking/messages";
import { SelectField } from "@/ui/features/booking/select-field";
import { Field } from "@/ui/primitives/field";

const NEW_TYPE: Pick<EventTypeDraft, "bufferMin" | "minNoticeMin"> = { bufferMin: 0, minNoticeMin: DEFAULT_MIN_NOTICE_MIN };

type Props = {
  /** Prefix of the control ids, unique on the page. */
  idPrefix: string;
  /** Values of the edited type; a new type starts with the defaults. */
  initial?: EventTypeDraft;
  errors: Partial<Record<EventTypeField, string>>;
};

function NumberField({
  idPrefix,
  name,
  label,
  defaultValue,
  error,
}: {
  idPrefix: string;
  name: keyof typeof EVENT_TYPE_BOUNDS;
  label: string;
  defaultValue: number | undefined;
  error: string | undefined;
}) {
  const { min, max } = EVENT_TYPE_BOUNDS[name];
  return (
    <Field
      id={`${idPrefix}-${name}`}
      name={name}
      label={label}
      type="number"
      inputMode="numeric"
      required
      min={min}
      max={max}
      step={1}
      defaultValue={defaultValue}
      error={error}
    />
  );
}

/** The six fields of a type, shared by the creation and the edition forms. */
export function EventTypeFields({ idPrefix, initial, errors }: Props) {
  return (
    <>
      <Field
        id={`${idPrefix}-title`}
        name="title"
        label="Titre"
        type="text"
        required
        maxLength={EVENT_TYPE_TITLE_MAX_LENGTH}
        defaultValue={initial?.title}
        error={errors.title}
      />
      <NumberField idPrefix={idPrefix} name="durationMin" label="Durée (minutes)" defaultValue={initial?.durationMin} error={errors.durationMin} />
      <NumberField
        idPrefix={idPrefix}
        name="bufferMin"
        label="Tampon après le rendez-vous (minutes)"
        defaultValue={(initial ?? NEW_TYPE).bufferMin}
        error={errors.bufferMin}
      />
      <NumberField
        idPrefix={idPrefix}
        name="minNoticeMin"
        label="Délai minimal de réservation (minutes)"
        defaultValue={(initial ?? NEW_TYPE).minNoticeMin}
        error={errors.minNoticeMin}
      />
      <SelectField
        id={`${idPrefix}-locationKind`}
        name="locationKind"
        label="Lieu"
        defaultValue={initial?.locationKind}
        error={errors.locationKind}
      >
        {LOCATION_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {LOCATION_KIND_LABELS[kind]}
          </option>
        ))}
      </SelectField>
      <Field
        id={`${idPrefix}-locationText`}
        name="locationText"
        label="Adresse ou lien de visio"
        type="text"
        maxLength={LOCATION_TEXT_MAX_LENGTH}
        defaultValue={initial?.locationText ?? undefined}
        error={errors.locationText}
        hint="Facultatif pour un rendez-vous par téléphone."
      />
    </>
  );
}
