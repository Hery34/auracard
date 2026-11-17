import { HTTPS_URL_MAX_LENGTH } from "@/domain/profile/https-url";
import { PHONE_MAX_LENGTH } from "@/domain/profile/phone";
import { PROFILE_TEXT_MAX_LENGTH } from "@/domain/profile/profile";
import type { EditorFields, TextFieldName } from "@/ui/features/profile-editor/editor-state";
import { PUBLIC_NUMBER_NOTICE } from "@/ui/features/profile-editor/messages";
import { Field } from "@/ui/primitives/field";
import { Label } from "@/ui/primitives/label";
import { Switch } from "@/ui/primitives/switch";
import { Textarea } from "@/ui/primitives/textarea";

type Props = {
  fields: EditorFields;
  errors: Partial<Record<TextFieldName, string>>;
  onChange: <K extends keyof EditorFields>(name: K, value: EditorFields[K]) => void;
};

/** The profile's own fields, in display order, then the two switches. */
export function ProfileFields({ fields, errors, onChange }: Props) {
  const text = (name: TextFieldName) => ({
    name,
    value: fields[name],
    error: errors[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(name, event.target.value),
  });

  return (
    <div className="flex flex-col gap-4">
      <Field {...text("displayName")} label="Nom affiché" type="text" autoComplete="name" required maxLength={PROFILE_TEXT_MAX_LENGTH.displayName} />
      <Field {...text("jobTitle")} label="Poste" type="text" autoComplete="organization-title" maxLength={PROFILE_TEXT_MAX_LENGTH.jobTitle} />
      <Field {...text("company")} label="Entreprise" type="text" autoComplete="organization" maxLength={PROFILE_TEXT_MAX_LENGTH.company} />
      <BioField value={fields.bio} error={errors.bio} onChange={(value) => onChange("bio", value)} />
      <Field {...text("contactEmail")} label="E-mail public" type="email" autoComplete="email" maxLength={PROFILE_TEXT_MAX_LENGTH.contactEmail} />
      <Field
        {...text("phone")}
        label="Téléphone"
        type="tel"
        autoComplete="tel"
        maxLength={PHONE_MAX_LENGTH}
        hint={fields.phone.trim() === "" ? undefined : PUBLIC_NUMBER_NOTICE}
      />
      <Field {...text("websiteUrl")} label="Site web" type="url" inputMode="url" autoComplete="url" placeholder="https://" maxLength={HTTPS_URL_MAX_LENGTH} />
      <SwitchField name="isPublished" label="Profil publié" checked={fields.isPublished} onChange={(value) => onChange("isPublished", value)} />
      <SwitchField
        name="isIndexable"
        label="Visible dans les moteurs de recherche"
        checked={fields.isIndexable}
        onChange={(value) => onChange("isIndexable", value)}
      />
    </div>
  );
}

const BIO_ID = "field-bio";

function BioField({ value, error, onChange }: { value: string; error: string | undefined; onChange: (value: string) => void }) {
  const errorId = `${BIO_ID}-error`;
  const counterId = `${BIO_ID}-counter`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={BIO_ID}>Bio</Label>
      <Textarea
        id={BIO_ID}
        name="bio"
        value={value}
        maxLength={PROFILE_TEXT_MAX_LENGTH.bio}
        rows={4}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? counterId : `${errorId} ${counterId}`}
        onChange={(event) => onChange(event.target.value)}
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p id={counterId} className="self-end text-sm text-muted-foreground">
        {value.length} / {PROFILE_TEXT_MAX_LENGTH.bio}
      </p>
    </div>
  );
}

function SwitchField({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = `field-${name}`;
  return (
    <Label htmlFor={id} className="min-h-11 cursor-pointer justify-between gap-4 py-2 leading-normal">
      <span>{label}</span>
      <Switch id={id} name={name} checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </Label>
  );
}
