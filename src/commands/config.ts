import {
  type ChatInputCommandInteraction,
  codeBlock,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { reloadConfigurationFiles } from '../configuration/files.js';
import {
  getConfigKeys,
  getConfigProperty,
  reloadDatabaseConfig,
  setConfigProperty,
} from '../configuration/main.js';
import { refreshOnConfigChange } from '../configuration/refresh.js';
import { getConfig } from '../data/database/Config.js';
import {
  BotConfigKeysSchema,
  BotConfigSchema,
  RequiredBotConfigSchema,
} from '../lib/schemas/BotConfig.js';
import {
  commandDescriptions,
  commandErrorFunctions,
  commandErrors,
  commandResponses,
} from '../translations/commands.js';
import { createCommandChoices } from '../utils/commands.js';

const name = 'config';
const permission = PermissionFlagsBits.ManageMessages;

export const data = new SlashCommandBuilder()
  .setName(name)
  .setDescription('Конгифурација')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('get')
      .setDescription(commandDescriptions['config get'])
      .addStringOption((option) =>
        option
          .setName('key')
          .setDescription('Клуч на конфигурација')
          .setRequired(false)
          .addChoices(...createCommandChoices(getConfigKeys())),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('set')
      .setDescription(commandDescriptions['config set'])
      .addStringOption((option) =>
        option
          .setName('key')
          .setDescription('Клуч на конфигурација')
          .setRequired(true)
          .addChoices(...createCommandChoices(getConfigKeys())),
      )
      .addStringOption((option) =>
        option
          .setName('value')
          .setDescription('Вредност на конфигурација')
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('reload')
      .setDescription(commandDescriptions['config reload']),
  )
  .setDefaultMemberPermissions(permission);

const handleConfigGet = async (interaction: ChatInputCommandInteraction) => {
  const rawKey = interaction.options.getString('key');

  if (rawKey === null) {
    const fullConfig = await getConfig();

    await interaction.editReply({
      files: [
        {
          attachment: Buffer.from(JSON.stringify(fullConfig, null, 2)),
          name: 'config.json',
        },
      ],
    });

    return;
  }

  const key = BotConfigKeysSchema.parse(rawKey);
  const value = getConfigProperty(key);

  const config = JSON.stringify(
    {
      [key]: value,
    },
    null,
    2,
  );

  if (config.length > 2_000) {
    await interaction.editReply({
      files: [
        {
          attachment: Buffer.from(config),
          name: 'config.json',
        },
      ],
    });

    return;
  }

  await interaction.editReply(codeBlock('json', config));
};

const handleConfigSet = async (interaction: ChatInputCommandInteraction) => {
  const key = BotConfigKeysSchema.parse(
    interaction.options.getString('key', true),
  );
  const rawValue = interaction.options.getString('value', true);
  let jsonValue: unknown;

  try {
    jsonValue = JSON.parse(rawValue);
  } catch (error) {
    await interaction.editReply(
      commandErrorFunctions.invalidConfiguration(error),
    );

    return;
  }

  const parsedValue = RequiredBotConfigSchema.shape[key].safeParse(jsonValue);

  if (!parsedValue.success) {
    await interaction.editReply(
      commandErrorFunctions.invalidConfiguration(parsedValue.error),
    );

    return;
  }

  const rawNewConfig = await setConfigProperty(key, parsedValue.data);

  if (rawNewConfig === null) {
    await interaction.editReply(commandErrors.configurationSavingFailed);

    return;
  }

  const newConfig = BotConfigSchema.safeParse(rawNewConfig);

  if (!newConfig.success) {
    await interaction.editReply(
      commandErrorFunctions.invalidConfiguration(newConfig.error),
    );

    return;
  }

  const newProperty = JSON.stringify(
    {
      [key]: newConfig.data?.[key],
    },
    null,
    2,
  );

  void refreshOnConfigChange(key);

  if (newProperty.length > 2_000) {
    await interaction.editReply({
      files: [
        {
          attachment: Buffer.from(newProperty),
          name: 'config.json',
        },
      ],
    });

    return;
  }

  await interaction.editReply(codeBlock('json', newProperty));
};

const handleConfigReload = async (interaction: ChatInputCommandInteraction) => {
  await interaction.editReply(commandResponses.configurationReloading);

  await Promise.all([reloadDatabaseConfig(), reloadConfigurationFiles()]);

  await interaction.editReply(commandResponses.configurationReloaded);
};

const configHandlers = {
  get: handleConfigGet,
  reload: handleConfigReload,
  set: handleConfigSet,
};

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand in configHandlers) {
    await configHandlers[subcommand as keyof typeof configHandlers](
      interaction,
    );
  }
};
