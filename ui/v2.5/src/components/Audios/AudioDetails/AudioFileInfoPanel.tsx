import React, { useMemo, useState } from "react";
import { Accordion, Button, Card } from "react-bootstrap";
import {
  FormattedMessage,
  FormattedNumber,
  FormattedTime,
  useIntl,
} from "react-intl";
import { useHistory } from "react-router-dom";
import { TruncatedText } from "src/components/Shared/TruncatedText";
import { DeleteFilesDialog } from "src/components/Shared/DeleteFilesDialog";
import { RevealInFilesystemButton } from "src/components/Shared/RevealInFilesystemButton";
import { ReassignFilesDialog } from "src/components/Shared/ReassignFilesDialog";
import * as GQL from "src/core/generated-graphql";
import { mutateAudioSetPrimaryFile } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import NavUtils from "src/utils/navigation";
import TextUtils from "src/utils/text";
import { TextField, URLField, URLsField } from "src/utils/field";
import { StashIDPill } from "src/components/Shared/StashID";
import { PatchComponent } from "../../../patch";
import { FileSize } from "src/components/Shared/FileSize";

interface IFileInfoPanelProps {
  audioID: string;
  file: GQL.VideoFileDataFragment;
  primary?: boolean;
  ofMany?: boolean;
  onSetPrimaryFile?: () => void;
  onDeleteFile?: () => void;
  onReassign?: () => void;
  loading?: boolean;
}

const FileInfoPanel: React.FC<IFileInfoPanelProps> = (
  props: IFileInfoPanelProps
) => {
  const intl = useIntl();
  const history = useHistory();

  // TODO - generalise fingerprints
  const oshash = props.file.fingerprints.find((f) => f.type === "oshash");
  const phash = props.file.fingerprints.find((f) => f.type === "phash");
  const checksum = props.file.fingerprints.find((f) => f.type === "md5");

  function onSplit() {
    history.push(
      `/audios/new?from_audio_id=${props.audioID}&file_id=${props.file.id}`
    );
  }

  return (
    <div>
      <dl className="container audio-file-info details-list">
        {props.primary && (
          <>
            <dt></dt>
            <dd className="primary-file">
              <FormattedMessage id="primary_file" />
            </dd>
          </>
        )}
        <TextField
          id="media_info.oshash"
          abbr={intl.formatMessage({ id: "media_info.oshash_meaning" })}
          value={oshash?.value}
          truncate
        />
        <TextField id="media_info.md5" value={checksum?.value} truncate />
        <URLField
          id="media_info.phash"
          abbr={intl.formatMessage({ id: "media_info.phash_meaning" })}
          value={phash?.value}
          url={NavUtils.makeAudiosPHashMatchUrl(phash?.value)}
          target="_self"
          truncate
          internal
        />
        <TextField id="path">
          <span className="d-flex align-items-center">
            <TruncatedText text={props.file.path} />
            <RevealInFilesystemButton fileId={props.file.id} />
          </span>
        </TextField>
        <TextField id="filesize">
          <span className="text-truncate">
            <FileSize size={props.file.size} />
          </span>
        </TextField>
        <TextField id="file_mod_time">
          <FormattedTime
            dateStyle="medium"
            timeStyle="medium"
            value={props.file.mod_time ?? 0}
          />
        </TextField>
        <TextField
          id="duration"
          value={TextUtils.secondsToTimestamp(props.file.duration ?? 0)}
          truncate
        />
        <TextField
          id="dimensions"
          value={`${props.file.width} x ${props.file.height}`}
          truncate
        />
        <TextField id="framerate">
          <FormattedMessage
            id="frames_per_second"
            values={{ value: intl.formatNumber(props.file.frame_rate ?? 0) }}
          />
        </TextField>
        <TextField id="bitrate">
          <FormattedMessage
            id="megabits_per_second"
            values={{
              value: intl.formatNumber((props.file.bit_rate ?? 0) / 1000000, {
                maximumFractionDigits: 2,
              }),
            }}
          />
        </TextField>
        <TextField
          id="media_info.video_codec"
          value={props.file.video_codec ?? ""}
          truncate
        />
        <TextField
          id="media_info.audio_codec"
          value={props.file.audio_codec ?? ""}
          truncate
        />
      </dl>
      {props.ofMany && props.onSetPrimaryFile && !props.primary && (
        <div>
          <Button
            className="edit-button"
            disabled={props.loading}
            onClick={props.onSetPrimaryFile}
          >
            <FormattedMessage id="actions.make_primary" />
          </Button>
          <Button
            className="edit-button"
            disabled={props.loading}
            onClick={props.onReassign}
          >
            <FormattedMessage id="actions.reassign" />
          </Button>
          <Button className="edit-button" onClick={onSplit}>
            <FormattedMessage id="actions.split" />
          </Button>
          <Button
            variant="danger"
            disabled={props.loading}
            onClick={props.onDeleteFile}
          >
            <FormattedMessage id="actions.delete_file" />
          </Button>
        </div>
      )}
    </div>
  );
};

interface IAudioFileInfoPanelProps {
  audio: GQL.AudioDataFragment;
}

const _AudioFileInfoPanel: React.FC<IAudioFileInfoPanelProps> = (
  props: IAudioFileInfoPanelProps
) => {
  const Toast = useToast();

  const [loading, setLoading] = useState(false);
  const [deletingFile, setDeletingFile] = useState<GQL.VideoFileDataFragment>();
  const [reassigningFile, setReassigningFile] =
    useState<GQL.VideoFileDataFragment>();

  function renderStashIDs() {
    if (!props.audio.stash_ids.length) {
      return;
    }

    return (
      <>
        <dt>
          <FormattedMessage id="stash_ids" />
        </dt>
        <dd>
          <dl>
            {props.audio.stash_ids.map((stashID) => {
              return (
                <dd key={stashID.stash_id} className="row no-gutters">
                  <StashIDPill stashID={stashID} linkType="audios" />
                </dd>
              );
            })}
          </dl>
        </dd>
      </>
    );
  }

  function renderFunscript() {
    if (props.audio.interactive) {
      return (
        <URLField
          name="Funscript"
          url={props.audio.paths.funscript}
          value={props.audio.paths.funscript}
          truncate
        />
      );
    }
  }

  function renderInteractiveSpeed() {
    if (props.audio.interactive_speed) {
      return (
        <TextField id="media_info.interactive_speed">
          <FormattedNumber value={props.audio.interactive_speed} />
        </TextField>
      );
    }
  }

  const filesPanel = useMemo(() => {
    if (props.audio.files.length === 0) {
      return;
    }

    if (props.audio.files.length === 1) {
      return (
        <FileInfoPanel audioID={props.audio.id} file={props.audio.files[0]} />
      );
    }

    async function onSetPrimaryFile(fileID: string) {
      try {
        setLoading(true);
        await mutateAudioSetPrimaryFile(props.audio.id, fileID);
      } catch (e) {
        Toast.error(e);
      } finally {
        setLoading(false);
      }
    }

    return (
      <Accordion defaultActiveKey={props.audio.files[0].id}>
        {deletingFile && (
          <DeleteFilesDialog
            onClose={() => setDeletingFile(undefined)}
            selected={[deletingFile]}
          />
        )}
        {reassigningFile && (
          <ReassignFilesDialog
            onClose={() => setReassigningFile(undefined)}
            selected={reassigningFile}
          />
        )}
        {props.audio.files.map((file, index) => (
          <Card key={file.id} className="audio-file-card">
            <Accordion.Toggle as={Card.Header} eventKey={file.id}>
              <TruncatedText text={TextUtils.fileNameFromPath(file.path)} />
            </Accordion.Toggle>
            <Accordion.Collapse eventKey={file.id}>
              <Card.Body>
                <FileInfoPanel
                  audioID={props.audio.id}
                  file={file}
                  primary={index === 0}
                  ofMany
                  onSetPrimaryFile={() => onSetPrimaryFile(file.id)}
                  onDeleteFile={() => setDeletingFile(file)}
                  onReassign={() => setReassigningFile(file)}
                  loading={loading}
                />
              </Card.Body>
            </Accordion.Collapse>
          </Card>
        ))}
      </Accordion>
    );
  }, [props.audio, loading, Toast, deletingFile, reassigningFile]);

  return (
    <>
      <dl className="container audio-file-info details-list">
        {props.audio.files.length > 0 && (
          <URLField
            id="media_info.stream"
            url={props.audio.paths.stream}
            value={props.audio.paths.stream}
            truncate
          />
        )}
        {renderFunscript()}
        {renderInteractiveSpeed()}
        <URLsField id="urls" urls={props.audio.urls} truncate />
        {renderStashIDs()}
      </dl>

      {filesPanel}
    </>
  );
};

export const AudioFileInfoPanel = PatchComponent(
  "AudioFileInfoPanel",
  _AudioFileInfoPanel
);
export default AudioFileInfoPanel;
