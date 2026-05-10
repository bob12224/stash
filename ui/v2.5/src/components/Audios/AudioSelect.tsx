import React, { useEffect, useMemo, useState } from "react";
import {
  OptionProps,
  components as reactSelectComponents,
  MultiValueGenericProps,
  SingleValueProps,
} from "react-select";
import cx from "classnames";

import * as GQL from "src/core/generated-graphql";
import {
  queryFindAudiosForSelect,
  queryFindAudiosByIDForSelect,
} from "src/core/StashService";
import { useConfigurationContext } from "src/hooks/Config";
import { useIntl } from "react-intl";
import { defaultMaxOptionsShown } from "src/core/config";
import { ListFilterModel } from "src/models/list-filter/filter";
import {
  FilterSelectComponent,
  IFilterIDProps,
  IFilterProps,
  IFilterValueProps,
  Option as SelectOption,
  toOption,
} from "../Shared/FilterSelect";
import { useCompare } from "src/hooks/state";
import { Placement } from "react-bootstrap/esm/Overlay";
import { sortByRelevance } from "src/utils/query";
import { objectTitle } from "src/core/files";
import { PatchComponent, PatchFunction } from "src/patch";
import {
  ModifierCriterion,
  CriterionValue,
} from "src/models/list-filter/criteria/criterion";
import { TruncatedText } from "../Shared/TruncatedText";
import { isUUID } from "src/utils/stashIds";
import { filterByStashID } from "src/models/list-filter/utils";

export type Audio = Pick<GQL.Audio, "id" | "title" | "date" | "code"> & {
  studio?: Pick<GQL.Studio, "name"> | null;
  files?: Pick<GQL.VideoFile, "path">[];
  paths?: Pick<GQL.AudioPathsType, "screenshot">;
};

type Option = SelectOption<Audio>;

type ExtraAudioProps = {
  hoverPlacement?: Placement;
  excludeIds?: string[];
  extraCriteria?: Array<ModifierCriterion<CriterionValue>>;
};

type FindAudiosResult = Awaited<
  ReturnType<typeof queryFindAudiosForSelect>
>["data"]["findAudios"]["audios"];

function sortAudiosByRelevance(input: string, audios: FindAudiosResult) {
  return sortByRelevance(input, audios, objectTitle, (s) => {
    return s.files.map((f) => f.path);
  });
}

const audioSelectSort = PatchFunction(
  "AudioSelect.sort",
  sortAudiosByRelevance
);

const _AudioSelect: React.FC<
  IFilterProps & IFilterValueProps<Audio> & ExtraAudioProps
> = (props) => {
  const { configuration } = useConfigurationContext();
  const intl = useIntl();
  const maxOptionsShown =
    configuration?.ui.maxOptionsShown ?? defaultMaxOptionsShown;

  const exclude = useMemo(() => props.excludeIds ?? [], [props.excludeIds]);

  function filterExcluded(audio: Audio) {
    // HACK - we should probably exclude these in the backend query, but
    // this will do in the short-term
    return !exclude.includes(audio.id.toString());
  }

  async function loadAudios(input: string): Promise<Option[]> {
    const filter = new ListFilterModel(GQL.FilterMode.Audios);
    filter.currentPage = 1;
    filter.itemsPerPage = maxOptionsShown;
    filter.sortBy = "title";
    filter.sortDirection = GQL.SortDirectionEnum.Asc;

    filter.criteria = [...(props.extraCriteria ?? [])];

    if (isUUID(input)) {
      const oldCriteria = filter.criteria;

      filterByStashID(filter, input);

      const query = await queryFindAudiosForSelect(filter);
      const matches = query.data.findAudios.audios.filter(filterExcluded);

      if (matches.length > 0) {
        // Matches found, return them immediately.
        return matches.map(toOption);
      }

      // If no stash_id matches found, continue with standard name/alias search.
      filter.criteria = oldCriteria; // Clear stash_id criterion to search by name/alias below.
    }

    filter.searchTerm = input;

    const query = await queryFindAudiosForSelect(filter);
    const ret = query.data.findAudios.audios.filter(filterExcluded);

    return audioSelectSort(input, ret).map(toOption);
  }

  const AudioOption: React.FC<OptionProps<Option, boolean>> = (optionProps) => {
    let thisOptionProps = optionProps;

    const { object } = optionProps.data;

    const title = objectTitle(object);

    // if title does not match the input value but the path does, show the path
    const { inputValue } = optionProps.selectProps;
    let matchedPath: string | undefined = "";
    if (!title.toLowerCase().includes(inputValue.toLowerCase())) {
      matchedPath = object.files?.find((a) =>
        a.path.toLowerCase().includes(inputValue.toLowerCase())
      )?.path;
    }

    thisOptionProps = {
      ...optionProps,
      children: (
        <span className="audio-select-option">
          <span className="audio-select-row">
            {object.paths?.screenshot && (
              <img
                className="audio-select-image"
                src={object.paths.screenshot}
                loading="lazy"
              />
            )}

            <span className="audio-select-details">
              <TruncatedText
                className="audio-select-title"
                text={title}
                lineCount={1}
              />

              {object.studio?.name && (
                <span className="audio-select-studio">
                  {object.studio?.name}
                </span>
              )}

              {object.date && (
                <span className="audio-select-date">{object.date}</span>
              )}

              {object.code && (
                <span className="audio-select-code">{object.code}</span>
              )}
            </span>
          </span>

          {matchedPath && (
            <span className="audio-select-alias">{`(${matchedPath})`}</span>
          )}
        </span>
      ),
    };

    return <reactSelectComponents.Option {...thisOptionProps} />;
  };

  const AudioMultiValueLabel: React.FC<
    MultiValueGenericProps<Option, boolean>
  > = (optionProps) => {
    let thisOptionProps = optionProps;

    const { object } = optionProps.data;

    thisOptionProps = {
      ...optionProps,
      children: objectTitle(object),
    };

    return <reactSelectComponents.MultiValueLabel {...thisOptionProps} />;
  };

  const AudioValueLabel: React.FC<SingleValueProps<Option, boolean>> = (
    optionProps
  ) => {
    let thisOptionProps = optionProps;

    const { object } = optionProps.data;

    thisOptionProps = {
      ...optionProps,
      children: <>{objectTitle(object)}</>,
    };

    return <reactSelectComponents.SingleValue {...thisOptionProps} />;
  };

  return (
    <FilterSelectComponent<Audio, boolean>
      {...props}
      className={cx(
        "audio-select",
        {
          "audio-select-active": props.active,
        },
        props.className
      )}
      loadOptions={loadAudios}
      components={{
        Option: AudioOption,
        MultiValueLabel: AudioMultiValueLabel,
        SingleValue: AudioValueLabel,
      }}
      isMulti={props.isMulti ?? false}
      placeholder={
        props.noSelectionString ??
        intl.formatMessage(
          { id: "actions.select_entity" },
          {
            entityType: intl.formatMessage({
              id: props.isMulti ? "audios" : "audio",
            }),
          }
        )
      }
      closeMenuOnSelect={!props.isMulti}
    />
  );
};

export const AudioSelect = PatchComponent("AudioSelect", _AudioSelect);

const _AudioIDSelect: React.FC<
  IFilterProps & IFilterIDProps<Audio> & ExtraAudioProps
> = (props) => {
  const { ids, onSelect: onSelectValues } = props;

  const [values, setValues] = useState<Audio[]>([]);
  const idsChanged = useCompare(ids);

  function onSelect(items: Audio[]) {
    setValues(items);
    onSelectValues?.(items);
  }

  async function loadObjectsByID(idsToLoad: string[]): Promise<Audio[]> {
    const query = await queryFindAudiosByIDForSelect(idsToLoad);
    const { audios: loadedAudios } = query.data.findAudios;

    return loadedAudios;
  }

  useEffect(() => {
    if (!idsChanged) {
      return;
    }

    if (!ids || ids?.length === 0) {
      setValues([]);
      return;
    }

    // load the values if we have ids and they haven't been loaded yet
    const filteredValues = values.filter((v) => ids.includes(v.id.toString()));
    if (filteredValues.length === ids.length) {
      return;
    }

    const load = async () => {
      const items = await loadObjectsByID(ids);
      setValues(items);
    };

    load();
  }, [ids, idsChanged, values]);

  return <AudioSelect {...props} values={values} onSelect={onSelect} />;
};

export const AudioIDSelect = PatchComponent("AudioIDSelect", _AudioIDSelect);
