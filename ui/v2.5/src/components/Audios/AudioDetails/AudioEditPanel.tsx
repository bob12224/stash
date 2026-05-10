import React, { useEffect, useState, useMemo } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Button,
  Dropdown,
  Form,
  Col,
  Row,
  ButtonGroup,
  SplitButton,
} from "react-bootstrap";
import Mousetrap from "mousetrap";
import * as GQL from "src/core/generated-graphql";
import * as yup from "yup";
import {
  queryScrapeAudio,
  queryScrapeAudioURL,
  useListAudioScrapers,
  mutateReloadScrapers,
  queryScrapeAudioQueryFragment,
} from "src/core/StashService";
import { Icon } from "src/components/Shared/Icon";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { ImageInput } from "src/components/Shared/ImageInput";
import { useToast } from "src/hooks/Toast";
import ImageUtils from "src/utils/image";
import { addUpdateStashID, getStashIDs } from "src/utils/stashIds";
import { useFormik } from "formik";
import { Prompt } from "react-router-dom";
import { useConfigurationContext } from "src/hooks/Config";
import { IGroupEntry, AudioGroupTable } from "./AudioGroupTable";
import { faSearch, faPlus } from "@fortawesome/free-solid-svg-icons";
import { objectTitle } from "src/core/files";
import { galleryTitle } from "src/core/galleries";
import { lazyComponent } from "src/utils/lazyComponent";
import isEqual from "lodash-es/isEqual";
import {
  yupDateString,
  yupFormikValidate,
  yupUniqueStringList,
} from "src/utils/yup";
import {
  Performer,
  PerformerSelect,
} from "src/components/Performers/PerformerSelect";
import { formikUtils } from "src/utils/form";
import { Studio, StudioSelect } from "src/components/Studios/StudioSelect";
import { Gallery, GallerySelect } from "src/components/Galleries/GallerySelect";
import { Group } from "src/components/Groups/GroupSelect";
import { useTagsEdit } from "src/hooks/tagsEdit";
import { ScraperMenu } from "src/components/Shared/ScraperMenu";
import StashBoxIDSearchModal from "src/components/Shared/StashBoxIDSearchModal";
import {
  CustomFieldsInput,
  formatCustomFieldInput,
} from "src/components/Shared/CustomFields";
import cloneDeep from "lodash-es/cloneDeep";

const AudioScrapeDialog = lazyComponent(() => import("./AudioScrapeDialog"));
const AudioQueryModal = lazyComponent(() => import("./AudioQueryModal"));

interface IProps {
  audio: Partial<GQL.AudioDataFragment>;
  initialCoverImage?: string;
  isNew?: boolean;
  isVisible: boolean;
  onSubmit: (input: GQL.AudioCreateInput, andNew?: boolean) => Promise<void>;
  onDelete?: () => void;
}

export const AudioEditPanel: React.FC<IProps> = ({
  audio,
  initialCoverImage,
  isNew = false,
  isVisible,
  onSubmit,
  onDelete,
}) => {
  const intl = useIntl();
  const Toast = useToast();

  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [studio, setStudio] = useState<Studio | null>(null);

  const Scrapers = useListAudioScrapers();
  const [fragmentScrapers, setFragmentScrapers] = useState<GQL.Scraper[]>([]);
  const [queryableScrapers, setQueryableScrapers] = useState<GQL.Scraper[]>([]);

  const [scraper, setScraper] = useState<GQL.ScraperSourceInput>();
  const [isScraperQueryModalOpen, setIsScraperQueryModalOpen] =
    useState<boolean>(false);
  const [isStashIDSearchOpen, setIsStashIDSearchOpen] =
    useState<boolean>(false);
  const [scrapedAudio, setScrapedAudio] = useState<GQL.ScrapedAudio | null>();
  const [endpoint, setEndpoint] = useState<string>();

  useEffect(() => {
    setGalleries(
      audio.galleries?.map((g) => ({
        id: g.id,
        title: galleryTitle(g),
        files: g.files,
        folder: g.folder,
      })) ?? []
    );
  }, [audio.galleries]);

  useEffect(() => {
    setPerformers(audio.performers ?? []);
  }, [audio.performers]);

  useEffect(() => {
    setGroups(audio.groups?.map((m) => m.group) ?? []);
  }, [audio.groups]);

  useEffect(() => {
    setStudio(audio.studio ?? null);
  }, [audio.studio]);

  const { configuration: stashConfig } = useConfigurationContext();

  // Network state
  const [isLoading, setIsLoading] = useState(false);

  const schema = yup.object({
    title: yup.string().ensure(),
    code: yup.string().ensure(),
    urls: yupUniqueStringList(intl),
    date: yupDateString(intl),
    director: yup.string().ensure(),
    gallery_ids: yup.array(yup.string().required()).defined(),
    studio_id: yup.string().required().nullable(),
    performer_ids: yup.array(yup.string().required()).defined(),
    groups: yup
      .array(
        yup.object({
          group_id: yup.string().required(),
          audio_index: yup.number().integer().nullable().defined(),
        })
      )
      .defined(),
    tag_ids: yup.array(yup.string().required()).defined(),
    stash_ids: yup.mixed<GQL.StashIdInput[]>().defined(),
    details: yup.string().ensure(),
    cover_image: yup.string().nullable().optional(),
    custom_fields: yup.object().required().defined(),
  });

  const initialValues = useMemo(
    () => ({
      title: audio.title ?? "",
      code: audio.code ?? "",
      urls: audio.urls ?? [],
      date: audio.date ?? "",
      director: audio.director ?? "",
      gallery_ids: (audio.galleries ?? []).map((g) => g.id),
      studio_id: audio.studio?.id ?? null,
      performer_ids: (audio.performers ?? []).map((p) => p.id),
      groups: (audio.groups ?? []).map((m) => {
        return { group_id: m.group.id, audio_index: m.audio_index ?? null };
      }),
      tag_ids: (audio.tags ?? []).map((t) => t.id),
      stash_ids: getStashIDs(audio.stash_ids),
      details: audio.details ?? "",
      cover_image: initialCoverImage,
      custom_fields: cloneDeep(audio.custom_fields ?? {}),
    }),
    [audio, initialCoverImage]
  );

  type InputValues = yup.InferType<typeof schema>;

  const [customFieldsError, setCustomFieldsError] = useState<string>();

  function submit(values: InputValues) {
    const input = {
      ...schema.cast(values),
      custom_fields: formatCustomFieldInput(isNew, values.custom_fields),
    };
    onSave(input);
  }

  const formik = useFormik<InputValues>({
    initialValues,
    enableReinitialize: true,
    validate: yupFormikValidate(schema),
    onSubmit: submit,
  });

  const { tags, updateTagsStateFromScraper, tagsControl } = useTagsEdit(
    audio.tags,
    (ids) => formik.setFieldValue("tag_ids", ids)
  );

  const coverImagePreview = useMemo(() => {
    const audioImage = audio.paths?.screenshot;
    const formImage = formik.values.cover_image;
    if (formImage === null && audioImage) {
      const audioImageURL = new URL(audioImage);
      audioImageURL.searchParams.set("default", "true");
      return audioImageURL.toString();
    } else if (formImage) {
      return formImage;
    }
    return audioImage;
  }, [formik.values.cover_image, audio.paths?.screenshot]);

  const groupEntries = useMemo(() => {
    return formik.values.groups
      .map((m) => {
        return {
          group: groups.find((mm) => mm.id === m.group_id),
          audio_index: m.audio_index,
        };
      })
      .filter((m) => m.group !== undefined) as IGroupEntry[];
  }, [formik.values.groups, groups]);

  function onSetGalleries(items: Gallery[]) {
    setGalleries(items);
    formik.setFieldValue(
      "gallery_ids",
      items.map((i) => i.id)
    );
  }

  function onSetPerformers(items: Performer[]) {
    setPerformers(items);
    formik.setFieldValue(
      "performer_ids",
      items.map((item) => item.id)
    );
  }

  function onSetStudio(item: Studio | null) {
    setStudio(item);
    formik.setFieldValue("studio_id", item ? item.id : null);
  }

  useEffect(() => {
    if (isVisible) {
      Mousetrap.bind("s s", () => {
        if (formik.dirty) {
          formik.submitForm();
        }
      });
      Mousetrap.bind("d d", () => {
        if (onDelete) {
          onDelete();
        }
      });

      return () => {
        Mousetrap.unbind("s s");
        Mousetrap.unbind("d d");
      };
    }
  });

  useEffect(() => {
    const toFilter = Scrapers?.data?.listScrapers ?? [];

    const newFragmentScrapers = toFilter.filter((s) =>
      s.audio?.supported_scrapes.includes(GQL.ScrapeType.Fragment)
    );
    const newQueryableScrapers = toFilter.filter((s) =>
      s.audio?.supported_scrapes.includes(GQL.ScrapeType.Name)
    );

    setFragmentScrapers(newFragmentScrapers);
    setQueryableScrapers(newQueryableScrapers);
  }, [Scrapers, stashConfig]);

  function onSetGroups(items: Group[]) {
    setGroups(items);

    const existingGroups = formik.values.groups;

    const newGroups = items.map((m) => {
      const existing = existingGroups.find((mm) => mm.group_id === m.id);
      if (existing) {
        return existing;
      }

      return {
        group_id: m.id,
        audio_index: null,
      };
    });

    formik.setFieldValue("groups", newGroups);
  }

  async function onSave(input: InputValues, andNew?: boolean) {
    setIsLoading(true);
    try {
      await onSubmit(input, andNew);
      formik.resetForm();
    } catch (e) {
      Toast.error(e);
    }
    setIsLoading(false);
  }

  async function onSaveAndNewClick() {
    const input = {
      ...schema.cast(formik.values),
      custom_fields: formatCustomFieldInput(isNew, formik.values.custom_fields),
    };
    onSave(input, true);
  }

  const encodingImage = ImageUtils.usePasteImage(onImageLoad);

  function onImageLoad(imageData: string) {
    formik.setFieldValue("cover_image", imageData);
  }

  function onCoverImageChange(event: React.FormEvent<HTMLInputElement>) {
    ImageUtils.onImageChange(event, onImageLoad);
  }

  function onResetCover() {
    formik.setFieldValue("cover_image", null);
  }

  async function onScrapeClicked(s: GQL.ScraperSourceInput) {
    setIsLoading(true);
    try {
      const result = await queryScrapeAudio(s, audio.id!);
      if (!result.data || !result.data.scrapeSingleAudio?.length) {
        Toast.success("No audios found");
        return;
      }
      // assume one returned audio
      setScrapedAudio(result.data.scrapeSingleAudio[0]);
      setEndpoint(s.stash_box_endpoint ?? undefined);
    } catch (e) {
      Toast.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  async function scrapeFromQuery(
    s: GQL.ScraperSourceInput,
    fragment: GQL.ScrapedAudioDataFragment
  ) {
    setIsLoading(true);
    try {
      const input: GQL.ScrapedAudioInput = {
        date: fragment.date,
        code: fragment.code,
        details: fragment.details,
        director: fragment.director,
        remote_site_id: fragment.remote_site_id,
        title: fragment.title,
        urls: fragment.urls,
      };

      const result = await queryScrapeAudioQueryFragment(s, input);
      if (!result.data || !result.data.scrapeSingleAudio?.length) {
        Toast.success("No audios found");
        return;
      }
      // assume one returned audio
      setScrapedAudio(result.data.scrapeSingleAudio[0]);
    } catch (e) {
      Toast.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  function onScrapeQueryClicked(s: GQL.ScraperSourceInput) {
    setScraper(s);
    setEndpoint(s.stash_box_endpoint ?? undefined);
    setIsScraperQueryModalOpen(true);
  }

  async function onReloadScrapers() {
    setIsLoading(true);
    try {
      await mutateReloadScrapers();
    } catch (e) {
      Toast.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  function onScrapeDialogClosed(audioData?: GQL.ScrapedAudioDataFragment) {
    if (audioData) {
      updateAudioFromScrapedAudio(audioData);
    }
    setScrapedAudio(undefined);
  }

  function maybeRenderScrapeDialog() {
    if (!scrapedAudio) {
      return;
    }

    const currentAudio = {
      id: audio.id!,
      ...formik.values,
    };

    if (!currentAudio.cover_image) {
      currentAudio.cover_image = audio.paths?.screenshot;
    }

    return (
      <AudioScrapeDialog
        audio={currentAudio}
        audioStudio={studio}
        audioTags={tags}
        audioPerformers={performers}
        audioGroups={groups}
        scraped={scrapedAudio}
        endpoint={endpoint}
        onClose={(s) => onScrapeDialogClosed(s)}
      />
    );
  }

  function onAudioSelected(s: GQL.ScrapedAudioDataFragment) {
    if (!scraper) return;

    if (scraper?.stash_box_endpoint !== undefined) {
      // must be stash-box - assume full audio
      setScrapedAudio(s);
    } else {
      // must be scraper
      scrapeFromQuery(scraper, s);
    }
  }

  const renderScrapeQueryModal = () => {
    if (!isScraperQueryModalOpen || !scraper) return;

    return (
      <AudioQueryModal
        scraper={scraper}
        onHide={() => setScraper(undefined)}
        onSelectAudio={(s) => {
          setIsScraperQueryModalOpen(false);
          setScraper(undefined);
          onAudioSelected(s);
        }}
        name={formik.values.title || objectTitle(audio) || ""}
      />
    );
  };

  function urlScrapable(scrapedUrl: string): boolean {
    return (Scrapers?.data?.listScrapers ?? []).some((s) =>
      (s?.audio?.urls ?? []).some((u) => scrapedUrl.includes(u))
    );
  }

  function updateAudioFromScrapedAudio(
    updatedAudio: GQL.ScrapedAudioDataFragment
  ) {
    if (updatedAudio.title) {
      formik.setFieldValue("title", updatedAudio.title);
    }

    if (updatedAudio.code) {
      formik.setFieldValue("code", updatedAudio.code);
    }

    if (updatedAudio.details) {
      formik.setFieldValue("details", updatedAudio.details);
    }

    if (updatedAudio.director) {
      formik.setFieldValue("director", updatedAudio.director);
    }

    if (updatedAudio.date) {
      formik.setFieldValue("date", updatedAudio.date);
    }

    if (updatedAudio.urls) {
      formik.setFieldValue("urls", updatedAudio.urls);
    }

    if (updatedAudio.studio && updatedAudio.studio.stored_id) {
      onSetStudio({
        id: updatedAudio.studio.stored_id,
        name: updatedAudio.studio.name ?? "",
        aliases: [],
      });
    }

    if (updatedAudio.performers && updatedAudio.performers.length > 0) {
      const idPerfs = updatedAudio.performers.filter((p) => {
        return p.stored_id !== undefined && p.stored_id !== null;
      });

      if (idPerfs.length > 0) {
        onSetPerformers(
          idPerfs.map((p) => {
            return {
              id: p.stored_id!,
              name: p.name ?? "",
              alias_list: [],
            };
          })
        );
      }
    }

    if (updatedAudio.groups && updatedAudio.groups.length > 0) {
      const idMovis = updatedAudio.groups.filter((p) => {
        return p.stored_id !== undefined && p.stored_id !== null;
      });

      if (idMovis.length > 0) {
        onSetGroups(
          idMovis.map((p) => {
            return {
              id: p.stored_id!,
              name: p.name ?? "",
            };
          })
        );
      }
    }

    updateTagsStateFromScraper(updatedAudio.tags ?? undefined);

    if (updatedAudio.image) {
      // image is a base64 string
      formik.setFieldValue("cover_image", updatedAudio.image);
    }

    if (updatedAudio.remote_site_id && endpoint) {
      let found = false;
      formik.setFieldValue(
        "stash_ids",
        formik.values.stash_ids.map((s) => {
          if (s.endpoint === endpoint) {
            found = true;
            return {
              endpoint,
              stash_id: updatedAudio.remote_site_id,
              updated_at: new Date().toISOString(),
            };
          }

          return s;
        })
      );

      if (!found) {
        formik.setFieldValue(
          "stash_ids",
          formik.values.stash_ids.concat({
            endpoint,
            stash_id: updatedAudio.remote_site_id,
            updated_at: new Date().toISOString(),
          })
        );
      }
    }
  }

  async function onScrapeAudioURL(url: string) {
    if (!url) {
      return;
    }
    setIsLoading(true);
    try {
      const result = await queryScrapeAudioURL(url);
      if (!result.data || !result.data.scrapeAudioURL) {
        return;
      }
      setScrapedAudio(result.data.scrapeAudioURL);
    } catch (e) {
      Toast.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  function onStashIDSelected(item?: GQL.StashIdInput) {
    if (!item) return;
    formik.setFieldValue(
      "stash_ids",
      addUpdateStashID(formik.values.stash_ids, item)
    );
  }

  const image = useMemo(() => {
    if (encodingImage) {
      return (
        <LoadingIndicator
          message={intl.formatMessage({ id: "actions.encoding_image" })}
        />
      );
    }

    if (coverImagePreview) {
      return (
        <img
          className="audio-cover"
          src={coverImagePreview}
          alt={intl.formatMessage({ id: "cover_image" })}
        />
      );
    }

    return <div></div>;
  }, [encodingImage, coverImagePreview, intl]);

  if (isLoading) return <LoadingIndicator />;

  const splitProps = {
    labelProps: {
      column: true,
      sm: 3,
    },
    fieldProps: {
      sm: 9,
    },
  };
  const fullWidthProps = {
    labelProps: {
      column: true,
      sm: 3,
      xl: 12,
    },
    fieldProps: {
      sm: 9,
      xl: 12,
    },
  };
  const urlProps = isNew
    ? splitProps
    : {
        labelProps: {
          column: true,
          md: 3,
          lg: 12,
        },
        fieldProps: {
          md: 9,
          lg: 12,
        },
      };
  const {
    renderField,
    renderInputField,
    renderDateField,
    renderURLListField,
    renderStashIDsField,
  } = formikUtils(intl, formik, splitProps);

  function renderGalleriesField() {
    const title = intl.formatMessage({ id: "galleries" });
    const control = (
      <GallerySelect
        values={galleries}
        onSelect={(items) => onSetGalleries(items)}
        isMulti
      />
    );

    return renderField("gallery_ids", title, control);
  }

  function renderStudioField() {
    const title = intl.formatMessage({ id: "studio" });
    const control = (
      <StudioSelect
        onSelect={(items) => onSetStudio(items.length > 0 ? items[0] : null)}
        values={studio ? [studio] : []}
      />
    );

    return renderField("studio_id", title, control);
  }

  function renderPerformersField() {
    const date = (() => {
      try {
        return schema.validateSyncAt("date", formik.values);
      } catch (e) {
        return undefined;
      }
    })();

    const title = intl.formatMessage({ id: "performers" });
    const control = (
      <PerformerSelect
        isMulti
        onSelect={onSetPerformers}
        values={performers}
        ageFromDate={date}
      />
    );

    return renderField("performer_ids", title, control, fullWidthProps);
  }

  function onSetGroupEntries(input: IGroupEntry[]) {
    setGroups(input.map((m) => m.group));

    const newGroups = input.map((m) => ({
      group_id: m.group.id,
      audio_index: m.audio_index,
    }));

    formik.setFieldValue("groups", newGroups);
  }

  function renderGroupsField() {
    const title = intl.formatMessage({ id: "groups" });
    const control = (
      <AudioGroupTable value={groupEntries} onUpdate={onSetGroupEntries} />
    );

    return renderField("groups", title, control, fullWidthProps);
  }

  function renderTagsField() {
    const title = intl.formatMessage({ id: "tags" });
    return renderField("tag_ids", title, tagsControl(), fullWidthProps);
  }

  function renderDetailsField() {
    const props = {
      labelProps: {
        column: true,
        sm: 3,
        lg: 12,
      },
      fieldProps: {
        sm: 9,
        lg: 12,
      },
    };

    return renderInputField("details", "textarea", "details", props);
  }

  return (
    <div id="audio-edit-details">
      <Prompt
        when={formik.dirty}
        message={intl.formatMessage({ id: "dialogs.unsaved_changes" })}
      />

      {renderScrapeQueryModal()}
      {maybeRenderScrapeDialog()}
      {isStashIDSearchOpen && (
        <StashBoxIDSearchModal
          entityType="audio"
          stashBoxes={stashConfig?.general.stashBoxes ?? []}
          excludedStashBoxEndpoints={formik.values.stash_ids.map(
            (s) => s.endpoint
          )}
          onSelectItem={(item) => {
            onStashIDSelected(item);
            setIsStashIDSearchOpen(false);
          }}
          initialQuery={audio.title ?? ""}
        />
      )}
      <Form noValidate onSubmit={formik.handleSubmit}>
        <Row className="form-container edit-buttons-container px-3 pt-3">
          <div className="edit-buttons mb-3 pl-0">
            {isNew ? (
              <SplitButton
                id="audio-save-split-button"
                className="edit-button"
                variant="primary"
                disabled={
                  !isEqual(formik.errors, {}) || customFieldsError !== undefined
                }
                title={intl.formatMessage({ id: "actions.save" })}
                onClick={() => formik.submitForm()}
              >
                <Dropdown.Item onClick={() => onSaveAndNewClick()}>
                  <FormattedMessage id="actions.save_and_new" />
                </Dropdown.Item>
              </SplitButton>
            ) : (
              <Button
                className="edit-button"
                variant="primary"
                disabled={
                  (!isNew && !formik.dirty) ||
                  !isEqual(formik.errors, {}) ||
                  customFieldsError !== undefined
                }
                onClick={() => formik.submitForm()}
              >
                <FormattedMessage id="actions.save" />
              </Button>
            )}
            {onDelete && (
              <Button
                className="edit-button"
                variant="danger"
                onClick={() => onDelete()}
              >
                <FormattedMessage id="actions.delete" />
              </Button>
            )}
          </div>
          {!isNew && (
            <div className="ml-auto text-right d-flex">
              <ButtonGroup className="scraper-group">
                <ScraperMenu
                  toggle={intl.formatMessage({ id: "actions.scrape_with" })}
                  stashBoxes={stashConfig?.general.stashBoxes ?? []}
                  scrapers={fragmentScrapers}
                  onScraperClicked={onScrapeClicked}
                  onReloadScrapers={onReloadScrapers}
                />
                <ScraperMenu
                  variant="secondary"
                  toggle={<Icon icon={faSearch} />}
                  stashBoxes={stashConfig?.general.stashBoxes ?? []}
                  scrapers={queryableScrapers}
                  onScraperClicked={onScrapeQueryClicked}
                  onReloadScrapers={onReloadScrapers}
                />
              </ButtonGroup>
            </div>
          )}
        </Row>
        <Row className="form-container px-3">
          <Col lg={7} xl={12}>
            {renderInputField("title")}
            {renderInputField("code", "text", "audio_code")}

            {renderURLListField(
              "urls",
              onScrapeAudioURL,
              urlScrapable,
              "urls",
              urlProps
            )}

            {renderDateField("date")}
            {renderInputField("director")}

            {renderGalleriesField()}
            {renderStudioField()}
            {renderPerformersField()}
            {renderGroupsField()}
            {renderTagsField()}

            {renderStashIDsField(
              "stash_ids",
              "audios",
              "stash_ids",
              fullWidthProps,
              <Button
                variant="success"
                className="mr-2 py-0"
                onClick={() => setIsStashIDSearchOpen(true)}
                disabled={!stashConfig?.general.stashBoxes?.length}
                title={intl.formatMessage({ id: "actions.add_stash_id" })}
              >
                <Icon icon={faPlus} />
              </Button>
            )}
          </Col>
          <Col lg={5} xl={12}>
            {renderDetailsField()}
            <Form.Group controlId="cover_image">
              <Form.Label>
                <FormattedMessage id="cover_image" />
              </Form.Label>
              {image}
              <ImageInput
                isEditing
                onImageChange={onCoverImageChange}
                onImageURL={onImageLoad}
                onReset={audio.id ? onResetCover : undefined}
              />
            </Form.Group>

            <CustomFieldsInput
              values={formik.values.custom_fields}
              onChange={(v) => formik.setFieldValue("custom_fields", v)}
              error={customFieldsError}
              setError={(e) => setCustomFieldsError(e)}
            />
          </Col>
        </Row>
      </Form>
    </div>
  );
};

export default AudioEditPanel;
