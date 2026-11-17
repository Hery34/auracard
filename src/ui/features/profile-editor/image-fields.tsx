import { PROFILE_IMAGE_KINDS, type ProfileImageKind } from "@/domain/profile/profile-image";
import type { EditorImages } from "@/ui/features/profile-editor/editor-state";
import { IMAGE_ERROR_MESSAGES } from "@/ui/features/profile-editor/messages";
import { IMAGE_URL_FIELDS, type ImageStatus } from "@/ui/features/profile-editor/use-profile-images";
import { Button } from "@/ui/primitives/button";
import { Label } from "@/ui/primitives/label";

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";
const PENDING_MESSAGE = "Envoi en cours…";
const FORMATS_HELP = "Formats acceptés : JPEG, PNG ou WebP.";
const PUBLIC_NOTICE = "Ces images sont visibles publiquement.";

const CONTROLS: Readonly<Record<ProfileImageKind, { label: string; removeLabel: string }>> = {
  avatar: { label: "Photo de profil", removeLabel: "Supprimer la photo de profil" },
  banner: { label: "Bannière", removeLabel: "Supprimer la bannière" },
  logo: { label: "Logo", removeLabel: "Supprimer le logo" },
};

type Props = {
  images: EditorImages;
  statuses: Readonly<Record<ProfileImageKind, ImageStatus>>;
  onSelect: (kind: ProfileImageKind, file: File) => void;
  onRemove: (kind: ProfileImageKind) => void;
};

/** One file control per image: sent as soon as a file is chosen, independently of « Enregistrer ». */
export function ImageFields({ images, statuses, onSelect, onRemove }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{PUBLIC_NOTICE}</p>
      {PROFILE_IMAGE_KINDS.map((kind) => (
        <ImageField
          key={kind}
          kind={kind}
          hasImage={images[IMAGE_URL_FIELDS[kind]] !== null}
          status={statuses[kind]}
          onSelect={(file) => onSelect(kind, file)}
          onRemove={() => onRemove(kind)}
        />
      ))}
    </div>
  );
}

type FieldProps = {
  kind: ProfileImageKind;
  hasImage: boolean;
  status: ImageStatus;
  onSelect: (file: File) => void;
  onRemove: () => void;
};

function ImageField({ kind, hasImage, status, onSelect, onRemove }: FieldProps) {
  const id = `image-${kind}`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const { label, removeLabel } = CONTROLS[kind];
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id={id}
          type="file"
          accept={ACCEPTED_TYPES}
          aria-invalid={status.error === null ? undefined : true}
          disabled={status.pending}
          aria-describedby={describedBy(helpId, status.error === null ? null : errorId)}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file !== undefined) {
              onSelect(file);
            }
          }}
          className="min-h-11 max-w-full text-base text-foreground file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-input file:bg-muted file:px-4 file:font-medium file:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
        />
        {hasImage && (
          <Button type="button" variant="outline" disabled={status.pending} onClick={onRemove}>
            {removeLabel}
          </Button>
        )}
      </div>
      <p id={helpId} className="text-sm text-muted-foreground">
        {FORMATS_HELP}
      </p>
      <p role="status" className="text-sm text-muted-foreground">
        {status.pending ? PENDING_MESSAGE : ""}
      </p>
      {status.error !== null && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {IMAGE_ERROR_MESSAGES[status.error]}
        </p>
      )}
    </div>
  );
}

function describedBy(helpId: string, errorId: string | null): string {
  return errorId === null ? helpId : `${helpId} ${errorId}`;
}
