import * as z from "zod/v4";

export const UNRAID_API_CATALOG_VERSION = "4.37.1" as const;
export const UNRAID_API_SCHEMA_URL =
  "https://github.com/unraid/api/blob/v4.37.1/api/generated-schema.graphql" as const;

export type UnraidOperationKind = "query" | "mutation";
export type UnraidSafetyClass = "read" | "routine" | "destructive" | "sensitive";

export interface UnraidApiOperation {
  readonly name: string;
  readonly kind: UnraidOperationKind;
  readonly schemaPath: string;
  readonly document: string;
  readonly inputSchema: z.ZodObject | null;
  readonly safety: UnraidSafetyClass;
  readonly requiresConfirmation: boolean;
  readonly minApiVersion: typeof UNRAID_API_CATALOG_VERSION;
  readonly description: string;
}

export interface UnraidSubscriptionCatalogEntry {
  readonly field: string;
  readonly document: string;
  readonly inputSchema: z.ZodObject | null;
  readonly safety: UnraidSafetyClass;
  readonly minApiVersion: typeof UNRAID_API_CATALOG_VERSION;
  readonly requestResponseMapping: string | null;
  readonly reason: string;
}

export interface UnraidCatalogGap {
  readonly surface: string;
  readonly fields: readonly string[];
  readonly reason: string;
}

const id = z.string().min(1);
const int = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const json = z.json();

const role = z.enum(["ADMIN", "CONNECT", "GUEST", "VIEWER"]);
const authAction = z.enum([
  "CREATE_ANY",
  "CREATE_OWN",
  "READ_ANY",
  "READ_OWN",
  "UPDATE_ANY",
  "UPDATE_OWN",
  "DELETE_ANY",
  "DELETE_OWN",
]);
const resource = z.enum([
  "ACTIVATION_CODE",
  "API_KEY",
  "ARRAY",
  "CLOUD",
  "CONFIG",
  "CONNECT",
  "CONNECT__REMOTE_ACCESS",
  "CUSTOMIZATIONS",
  "DASHBOARD",
  "DISK",
  "DISPLAY",
  "DOCKER",
  "FLASH",
  "INFO",
  "LOGS",
  "ME",
  "NETWORK",
  "NOTIFICATIONS",
  "ONLINE",
  "OS",
  "OWNER",
  "PERMISSION",
  "REGISTRATION",
  "SERVERS",
  "SERVICES",
  "SHARE",
  "VARS",
  "VMS",
  "WELCOME",
]);
const permissionInput = z
  .object({ resource, actions: z.array(authAction) })
  .strict();
const notificationImportance = z.enum(["ALERT", "INFO", "WARNING"]);
const notificationType = z.enum(["UNREAD", "ARCHIVE"]);
const themeName = z.enum(["azure", "black", "gray", "white"]);
const registrationState = z.enum([
  "TRIAL",
  "BASIC",
  "PLUS",
  "PRO",
  "STARTER",
  "UNLEASHED",
  "LIFETIME",
  "EEXPIRED",
  "EGUID",
  "EGUID1",
  "ETRIAL",
  "ENOKEYFILE",
  "ENOKEYFILE1",
  "ENOKEYFILE2",
  "ENOFLASH",
  "ENOFLASH1",
  "ENOFLASH2",
  "ENOFLASH3",
  "ENOFLASH4",
  "ENOFLASH5",
  "ENOFLASH6",
  "ENOFLASH7",
  "EBLACKLISTED",
  "EBLACKLISTED1",
  "EBLACKLISTED2",
  "ENOCONN",
]);
const urlType = z.enum(["LAN", "WIREGUARD", "WAN", "MDNS", "OTHER", "DEFAULT"]);
const wanAccessType = z.enum(["DYNAMIC", "ALWAYS", "DISABLED"]);
const wanForwardType = z.enum(["UPNP", "STATIC"]);

const notificationFilter = z
  .object({
    importance: notificationImportance.optional(),
    type: notificationType,
    offset: int.min(0),
    limit: int.min(1).max(1_000),
  })
  .strict();
const notificationData = z
  .object({
    title: z.string().min(1),
    subject: z.string().min(1),
    description: z.string(),
    importance: notificationImportance,
    link: z.string().optional(),
  })
  .strict();
const dockerAutostartEntry = z
  .object({ id, autoStart: z.boolean(), wait: int.min(0).optional() })
  .strict();
const arrayDiskInput = z.object({ id, slot: int.optional() }).strict();
const pluginInstallInput = z
  .object({ url: z.url(), name: z.string().min(1).optional(), forced: z.boolean().optional() })
  .strict();
const rcloneConfigFormInput = z
  .object({
    providerType: z.string().optional(),
    showAdvanced: z.boolean().optional(),
    parameters: json.optional(),
  })
  .strict();
const partnerLinkInput = z.object({ title: z.string(), url: z.string() }).strict();
const partnerConfigInput = z
  .object({
    name: z.string().optional(),
    url: z.string().optional(),
    hardwareSpecsUrl: z.string().optional(),
    manualUrl: z.string().optional(),
    supportUrl: z.string().optional(),
    extraLinks: z.array(partnerLinkInput).optional(),
  })
  .strict();
const brandingConfigInput = z
  .object({
    header: z.string().optional(),
    headermetacolor: z.string().optional(),
    background: z.string().optional(),
    showBannerGradient: z.boolean().optional(),
    theme: z.string().optional(),
    bannerImage: z.string().optional(),
    caseModel: z.string().optional(),
    caseModelImage: z.string().optional(),
    partnerLogoLightUrl: z.string().optional(),
    partnerLogoDarkUrl: z.string().optional(),
    hasPartnerLogo: z.boolean().optional(),
    onboardingTitle: z.string().optional(),
    onboardingSubtitle: z.string().optional(),
    onboardingTitleFreshInstall: z.string().optional(),
    onboardingSubtitleFreshInstall: z.string().optional(),
    onboardingTitleUpgrade: z.string().optional(),
    onboardingSubtitleUpgrade: z.string().optional(),
    onboardingTitleDowngrade: z.string().optional(),
    onboardingSubtitleDowngrade: z.string().optional(),
    onboardingTitleIncomplete: z.string().optional(),
    onboardingSubtitleIncomplete: z.string().optional(),
  })
  .strict();
const systemConfigInput = z
  .object({
    serverName: z.string().optional(),
    model: z.string().optional(),
    comment: z.string().optional(),
  })
  .strict();
const onboardingOverrideInput = z
  .object({
    onboarding: z
      .object({
        completed: z.boolean().optional(),
        completedAtVersion: z.string().optional(),
        forceOpen: z.boolean().optional(),
      })
      .strict()
      .optional(),
    activationCode: z
      .object({
        code: z.string().optional(),
        partner: partnerConfigInput.optional(),
        branding: brandingConfigInput.optional(),
        system: systemConfigInput.optional(),
      })
      .strict()
      .optional(),
    partnerInfo: z
      .object({
        partner: partnerConfigInput.optional(),
        branding: brandingConfigInput.optional(),
      })
      .strict()
      .optional(),
    registrationState: registrationState.optional(),
  })
  .strict();

const PERMISSION_FIELDS = "resource actions";
const API_KEY_SAFE_FIELDS = `
  id name description roles createdAt
  permissions { ${PERMISSION_FIELDS} }
`;
const API_KEY_CREATED_FIELDS = `
  id key name description roles createdAt
  permissions { ${PERMISSION_FIELDS} }
`;
const THEME_FIELDS = `
  name showBannerImage showBannerGradient showHeaderDescription
  headerBackgroundColor headerPrimaryTextColor headerSecondaryTextColor
`;
const NOTIFICATION_FIELDS = `
  id title subject description importance link type timestamp formattedTimestamp
`;
const NOTIFICATION_OVERVIEW_FIELDS = `
  unread { info warning alert total }
  archive { info warning alert total }
`;
const ARRAY_DISK_FIELDS = `
  id idx name device size status rotational temp numReads numWrites numErrors
  fsSize fsFree fsUsed exportable type warning critical fsType comment format
  transport color isSpinning
`;
const PARITY_FIELDS = `
  date duration speed status errors progress correcting paused running
`;
const ARRAY_FIELDS = `
  id state
  capacity { kilobytes { free used total } disks { free used total } }
  parityCheckStatus { ${PARITY_FIELDS} }
  boot { ${ARRAY_DISK_FIELDS} }
  bootDevices { ${ARRAY_DISK_FIELDS} }
  parities { ${ARRAY_DISK_FIELDS} }
  disks { ${ARRAY_DISK_FIELDS} }
  caches { ${ARRAY_DISK_FIELDS} }
`;
const DISK_SAFE_FIELDS = `
  id device type name vendor size bytesPerSector firmwareRevision interfaceType
  smartStatus temperature isSpinning partitions { name fsType size }
`;
const NETWORK_INTERFACE_FIELDS = `
  id name description macAddress mtu speed duplex internal virtual operstate type vlanId
  ipv4Addresses { address netmask }
  ipv6Addresses { address prefixLength }
  status protocol ipAddress netmask gateway useDhcp
  ipv6Address ipv6Netmask ipv6Gateway useDhcp6
`;
const DOCKER_CONTAINER_SAFE_FIELDS = `
  id names image imageId created
  ports { ip privatePort publicPort type }
  lanIpPorts sizeRootFs sizeRw sizeLog state status
  hostConfig { networkMode }
  autoStart autoStartOrder autoStartWait templatePath
  projectUrl registryUrl supportUrl iconUrl webUiUrl shell
  templatePorts { ip privatePort publicPort type }
  isOrphaned isUpdateAvailable isRebuildReady tailscaleEnabled
`;
const ONBOARDING_SAFE_FIELDS = `
  status isPartnerBuild completed completedAtVersion shouldOpen
  onboardingState {
    registrationState isRegistered isFreshInstall hasActivationCode activationRequired
  }
`;
const INTERNAL_BOOT_CONTEXT_FIELDS = `
  arrayStopped bootEligible bootedFromFlashWithInternalBootSetup enableBootTransfer
  reservedNames shareNames poolNames
  assignableDisks { ${DISK_SAFE_FIELDS} }
  driveWarnings { diskId device warnings }
`;
const PLUGIN_INSTALL_FIELDS = `
  id url name status createdAt updatedAt finishedAt
`;
const UPS_DEVICE_FIELDS = `
  id name model status
  battery { chargeLevel estimatedRuntime health }
  power { inputVoltage outputVoltage loadPercentage nominalPower currentPower }
`;
const OIDC_PROVIDER_SAFE_FIELDS = `
  id name clientId issuer authorizationEndpoint tokenEndpoint jwksUri scopes
  authorizationRules { claim operator value }
  authorizationRuleMode buttonText buttonVariant buttonStyle
`;
const ORGANIZER_SAFE_FIELDS = `
  version
  views {
    id name rootId
    flatEntries { id type name parentId depth position path hasChildren childrenIds }
  }
`;

function defineOperation(operation: Omit<UnraidApiOperation, "minApiVersion">): UnraidApiOperation {
  return Object.freeze({ ...operation, minApiVersion: UNRAID_API_CATALOG_VERSION });
}

function query(
  name: string,
  schemaPath: string,
  document: string,
  inputSchema: z.ZodObject | null,
  safety: UnraidSafetyClass,
  description: string,
  requiresConfirmation = false,
): UnraidApiOperation {
  return defineOperation({
    name,
    kind: "query",
    schemaPath,
    document,
    inputSchema,
    safety,
    requiresConfirmation,
    description,
  });
}

function mutation(
  name: string,
  schemaPath: string,
  document: string,
  inputSchema: z.ZodObject | null,
  safety: UnraidSafetyClass,
  description: string,
): UnraidApiOperation {
  return defineOperation({
    name,
    kind: "mutation",
    schemaPath,
    document,
    inputSchema,
    safety,
    requiresConfirmation: safety !== "routine",
    description,
  });
}

const queryOperations: UnraidApiOperation[] = [
  query(
    "UnraidV4371QueryApiKeys",
    "apiKeys",
    `query UnraidV4371QueryApiKeys { apiKeys { ${API_KEY_SAFE_FIELDS} } }`,
    null,
    "sensitive",
    "List API key metadata and grants without returning key material.",
  ),
  query(
    "UnraidV4371QueryApiKey",
    "apiKey",
    `query UnraidV4371QueryApiKey($id: PrefixedID!) { apiKey(id: $id) { ${API_KEY_SAFE_FIELDS} } }`,
    z.object({ id }).strict(),
    "sensitive",
    "Get one API key's metadata and grants without returning key material.",
  ),
  query(
    "UnraidV4371QueryApiKeyPossibleRoles",
    "apiKeyPossibleRoles",
    "query UnraidV4371QueryApiKeyPossibleRoles { apiKeyPossibleRoles }",
    null,
    "read",
    "List roles accepted by API key operations.",
  ),
  query(
    "UnraidV4371QueryApiKeyPossiblePermissions",
    "apiKeyPossiblePermissions",
    `query UnraidV4371QueryApiKeyPossiblePermissions {
      apiKeyPossiblePermissions { ${PERMISSION_FIELDS} }
    }`,
    null,
    "read",
    "List explicit permissions accepted by API key operations.",
  ),
  query(
    "UnraidV4371QueryPermissionsForRoles",
    "getPermissionsForRoles",
    `query UnraidV4371QueryPermissionsForRoles($roles: [Role!]!) {
      getPermissionsForRoles(roles: $roles) { ${PERMISSION_FIELDS} }
    }`,
    z.object({ roles: z.array(role) }).strict(),
    "sensitive",
    "Resolve the permissions granted by a set of roles.",
  ),
  query(
    "UnraidV4371QueryPreviewEffectivePermissions",
    "previewEffectivePermissions",
    `query UnraidV4371QueryPreviewEffectivePermissions(
      $roles: [Role!]
      $permissions: [AddPermissionInput!]
    ) {
      previewEffectivePermissions(roles: $roles, permissions: $permissions) {
        ${PERMISSION_FIELDS}
      }
    }`,
    z.object({
      roles: z.array(role).optional(),
      permissions: z.array(permissionInput).optional(),
    }).strict(),
    "sensitive",
    "Preview effective role and explicit permission grants.",
  ),
  query(
    "UnraidV4371QueryAvailableAuthActions",
    "getAvailableAuthActions",
    "query UnraidV4371QueryAvailableAuthActions { getAvailableAuthActions }",
    null,
    "read",
    "List authentication actions supported by the API.",
  ),
  query(
    "UnraidV4371QueryApiKeyCreationFormSchema",
    "getApiKeyCreationFormSchema",
    `query UnraidV4371QueryApiKeyCreationFormSchema {
      getApiKeyCreationFormSchema { id dataSchema uiSchema }
    }`,
    null,
    "sensitive",
    "Get the API-key form schemas; current form values are deliberately excluded.",
  ),
  query(
    "UnraidV4371QueryConfig",
    "config",
    "query UnraidV4371QueryConfig { config { id valid error } }",
    null,
    "read",
    "Get core configuration validity and its current error.",
  ),
  query(
    "UnraidV4371QueryDisplay",
    "display",
    `query UnraidV4371QueryDisplay {
      display {
        id case { id url icon error }
        theme unit scale tabs resize wwn total usage text warning critical hot max locale
      }
    }`,
    null,
    "read",
    "Get display preferences without returning the base64 case image.",
  ),
  query(
    "UnraidV4371QueryFlash",
    "flash",
    "query UnraidV4371QueryFlash { flash { id guid vendor product } }",
    null,
    "sensitive",
    "Get boot flash identity and hardware identifiers.",
  ),
  query(
    "UnraidV4371QueryMe",
    "me",
    `query UnraidV4371QueryMe {
      me { id name description roles permissions { ${PERMISSION_FIELDS} } }
    }`,
    null,
    "sensitive",
    "Get the authenticated account and its authorization grants.",
  ),
  query(
    "UnraidV4371QueryNotifications",
    "notifications",
    `query UnraidV4371QueryNotifications($filter: NotificationFilter!) {
      notifications {
        id overview { ${NOTIFICATION_OVERVIEW_FIELDS} }
        list(filter: $filter) { ${NOTIFICATION_FIELDS} }
        warningsAndAlerts { ${NOTIFICATION_FIELDS} }
      }
    }`,
    z.object({ filter: notificationFilter }).strict(),
    "sensitive",
    "Get notification counts, a bounded filtered page, and current warnings and alerts.",
  ),
  query(
    "UnraidV4371QueryOnline",
    "online",
    "query UnraidV4371QueryOnline { online }",
    null,
    "read",
    "Check whether the Unraid API reports itself online.",
  ),
  query(
    "UnraidV4371QueryOwner",
    "owner",
    "query UnraidV4371QueryOwner { owner { username url avatar } }",
    null,
    "sensitive",
    "Get the connected Unraid account profile.",
  ),
  query(
    "UnraidV4371QueryInternalBootContext",
    "internalBootContext",
    `query UnraidV4371QueryInternalBootContext {
      internalBootContext { ${INTERNAL_BOOT_CONTEXT_FIELDS} }
    }`,
    null,
    "sensitive",
    "Get internal-boot eligibility, names, disks, and destructive-operation warnings.",
  ),
  query(
    "UnraidV4371QueryRegistration",
    "registration",
    `query UnraidV4371QueryRegistration {
      registration { id type state expiration updateExpiration }
    }`,
    null,
    "sensitive",
    "Get registration state without returning license-key file location or contents.",
  ),
  query(
    "UnraidV4371QueryServer",
    "server",
    `query UnraidV4371QueryServer {
      server {
        id owner { id username url avatar } guid name comment status
        wanip lanip localurl remoteurl
      }
    }`,
    null,
    "sensitive",
    "Get the current connected-server record without returning its API key.",
  ),
  query(
    "UnraidV4371QueryServers",
    "servers",
    `query UnraidV4371QueryServers {
      servers {
        id owner { id username url avatar } guid name comment status
        wanip lanip localurl remoteurl
      }
    }`,
    null,
    "sensitive",
    "List connected-server records without returning their API keys.",
  ),
  query(
    "UnraidV4371QueryServices",
    "services",
    `query UnraidV4371QueryServices {
      services { id name online uptime { timestamp } version }
    }`,
    null,
    "read",
    "List service status, uptime, and version information.",
  ),
  query(
    "UnraidV4371QueryShares",
    "shares",
    `query UnraidV4371QueryShares {
      shares {
        id name free used size include exclude cache nameOrig comment allocator splitLevel
        floor cow color luksStatus
      }
    }`,
    null,
    "sensitive",
    "List share capacity, placement, and filesystem settings.",
  ),
  query(
    "UnraidV4371QueryVars",
    "vars",
    `query UnraidV4371QueryVars {
      vars {
        id version maxArraysz maxCachesz name timeZone comment security workgroup
        domain domainShort hideDotFiles localMaster enableFruit useNtp
        sysModel sysArraySlots sysCacheSlots sysFlashSlots useSsl port portssl localTld
        bindMgt useTelnet porttelnet useSsh portssh startArray spindownDelay queueDepth
        spinupGroups defaultFormat defaultFsType shutdownTimeout safeMode startMode
        configValid configError joinStatus deviceCount bootEligible enableBootTransfer
        bootedFromFlashWithInternalBootSetup reservedNames fsProgress fsCopyPrcnt
        fsNumMounted fsNumUnmountable shareCount shareSmbCount shareNfsCount
        shareAfpCount shareMoverActive mdState mdNumDisks mdNumDisabled mdNumInvalid
        mdNumMissing mdNumNew mdNumErased mdResync mdResyncAction mdResyncSize
      }
    }`,
    null,
    "sensitive",
    "Get a safe operational projection of Unraid vars; credentials and unique device IDs are excluded.",
  ),
  query(
    "UnraidV4371QueryVms",
    "vms",
    "query UnraidV4371QueryVms { vms { id domains { id name state } } }",
    null,
    "read",
    "List virtual machines and their states.",
  ),
  query(
    "UnraidV4371QueryParityHistory",
    "parityHistory",
    `query UnraidV4371QueryParityHistory { parityHistory { ${PARITY_FIELDS} } }`,
    null,
    "read",
    "List parity-check history and outcomes.",
  ),
  query(
    "UnraidV4371QueryArray",
    "array",
    `query UnraidV4371QueryArray { array { ${ARRAY_FIELDS} } }`,
    null,
    "read",
    "Get array state, capacity, parity status, and member disks.",
  ),
  query(
    "UnraidV4371QueryCustomization",
    "customization",
    `query UnraidV4371QueryCustomization {
      customization {
        activationCode {
          partner { name url hardwareSpecsUrl manualUrl supportUrl extraLinks { title url } }
          branding {
            header headermetacolor background showBannerGradient theme caseModel
            hasPartnerLogo onboardingTitle onboardingSubtitle
          }
          system { serverName model comment }
        }
        onboarding { ${ONBOARDING_SAFE_FIELDS} }
        availableLanguages { code name url }
      }
    }`,
    null,
    "sensitive",
    "Get safe customization and onboarding metadata without activation codes or embedded images.",
  ),
  query(
    "UnraidV4371QueryIsFreshInstall",
    "isFreshInstall",
    "query UnraidV4371QueryIsFreshInstall { isFreshInstall }",
    null,
    "read",
    "Check whether the server has no license key.",
  ),
  query(
    "UnraidV4371QueryPublicTheme",
    "publicTheme",
    `query UnraidV4371QueryPublicTheme { publicTheme { ${THEME_FIELDS} } }`,
    null,
    "read",
    "Get the public WebGUI theme.",
  ),
  query(
    "UnraidV4371QueryInfo",
    "info",
    `query UnraidV4371QueryInfo {
      info {
        id time
        baseboard { id manufacturer model version memMax memSlots }
        cpu {
          id manufacturer brand vendor family model stepping revision voltage speed speedmin
          speedmax threads cores processors socket flags topology
          packages { id totalPower power temp }
        }
        devices {
          id
          gpu { id type typeid blacklisted class productid vendorname }
          network { id iface model vendor mac virtual speed dhcp }
          pci { id type typeid vendorname vendorid productname productid blacklisted class }
          usb { id name bus device }
        }
        memory {
          id layout {
            id size bank type clockSpeed manufacturer formFactor
            voltageConfigured voltageMin voltageMax
          }
        }
        os { id platform distro release codename kernel arch hostname fqdn build servicepack uptime logofile uefi }
        system { id manufacturer model version virtual }
        versions {
          id core { unraid api kernel }
          packages { openssl node npm pm2 git nginx php docker }
        }
        networkInterfaces { ${NETWORK_INTERFACE_FIELDS} }
        primaryNetwork { ${NETWORK_INTERFACE_FIELDS} }
      }
    }`,
    null,
    "sensitive",
    "Get detailed system inventory while excluding machine, hardware, OS, and DIMM serial identifiers.",
  ),
  query(
    "UnraidV4371QueryNetworkInterfaces",
    "networkInterfaces",
    `query UnraidV4371QueryNetworkInterfaces {
      networkInterfaces { ${NETWORK_INTERFACE_FIELDS} }
    }`,
    null,
    "sensitive",
    "List network interfaces, addresses, routes, and link state.",
  ),
  query(
    "UnraidV4371QueryDocker",
    "docker",
    `query UnraidV4371QueryDocker {
      docker {
        id
        containers { ${DOCKER_CONTAINER_SAFE_FIELDS} }
        networks { id name created scope driver enableIPv6 internal attachable ingress configOnly }
        portConflicts {
          containerPorts { privatePort type containers { id name } }
          lanPorts { lanIpPort publicPort type containers { id name } }
        }
        organizer { ${ORGANIZER_SAFE_FIELDS} }
        containerUpdateStatuses { name updateStatus }
      }
    }`,
    null,
    "sensitive",
    "Get Docker inventory, safe network metadata, port conflicts, organization, and update status.",
  ),
  query(
    "UnraidV4371QueryDisks",
    "disks",
    `query UnraidV4371QueryDisks { disks { ${DISK_SAFE_FIELDS} } }`,
    null,
    "sensitive",
    "List attached disks without returning serial numbers or geometry details.",
  ),
  query(
    "UnraidV4371QueryAssignableDisks",
    "assignableDisks",
    `query UnraidV4371QueryAssignableDisks { assignableDisks { ${DISK_SAFE_FIELDS} } }`,
    null,
    "sensitive",
    "List disks eligible for assignment without returning serial numbers or geometry details.",
  ),
  query(
    "UnraidV4371QueryDisk",
    "disk",
    `query UnraidV4371QueryDisk($id: PrefixedID!) { disk(id: $id) { ${DISK_SAFE_FIELDS} } }`,
    z.object({ id }).strict(),
    "sensitive",
    "Get one disk without returning its serial number or detailed geometry.",
  ),
  query(
    "UnraidV4371QueryRclone",
    "rclone",
    `query UnraidV4371QueryRclone($formOptions: RCloneConfigFormInput) {
      rclone {
        configForm(formOptions: $formOptions) { id dataSchema uiSchema }
        drives { name }
        remotes { name type }
      }
    }`,
    z.object({ formOptions: rcloneConfigFormInput.optional() }).strict(),
    "sensitive",
    "Get rclone form schemas, provider names, and remote names without returning remote configuration or parameters.",
    true,
  ),
  query(
    "UnraidV4371QueryLogFiles",
    "logFiles",
    "query UnraidV4371QueryLogFiles { logFiles { name path size modifiedAt } }",
    null,
    "sensitive",
    "List readable system log files and metadata.",
  ),
  query(
    "UnraidV4371QueryLogFile",
    "logFile",
    `query UnraidV4371QueryLogFile($path: String!, $lines: Int, $startLine: Int) {
      logFile(path: $path, lines: $lines, startLine: $startLine) {
        path content totalLines startLine
      }
    }`,
    z.object({
      path: z.string().min(1),
      lines: int.min(1).max(2_000).optional(),
      startLine: int.min(1).optional(),
    }).strict(),
    "sensitive",
    "Read a bounded section of a server log file.",
  ),
  query(
    "UnraidV4371QuerySettings",
    "settings",
    `query UnraidV4371QuerySettings {
      settings {
        id
        sso { id oidcProviders { ${OIDC_PROVIDER_SAFE_FIELDS} } }
        api { version extraOrigins sandbox ssoSubIds plugins }
      }
    }`,
    null,
    "sensitive",
    "Get a safe settings projection without unified values, schemas, or OIDC client secrets.",
  ),
  query(
    "UnraidV4371QueryIsSsoEnabled",
    "isSSOEnabled",
    "query UnraidV4371QueryIsSsoEnabled { isSSOEnabled }",
    null,
    "read",
    "Check whether SSO is enabled.",
  ),
  query(
    "UnraidV4371QueryPublicOidcProviders",
    "publicOidcProviders",
    `query UnraidV4371QueryPublicOidcProviders {
      publicOidcProviders { id name buttonText buttonVariant buttonStyle }
    }`,
    null,
    "read",
    "List public OIDC login-button metadata.",
  ),
  query(
    "UnraidV4371QueryOidcProviders",
    "oidcProviders",
    `query UnraidV4371QueryOidcProviders {
      oidcProviders { ${OIDC_PROVIDER_SAFE_FIELDS} }
    }`,
    null,
    "sensitive",
    "List OIDC provider configuration without client secrets.",
  ),
  query(
    "UnraidV4371QueryOidcProvider",
    "oidcProvider",
    `query UnraidV4371QueryOidcProvider($id: PrefixedID!) {
      oidcProvider(id: $id) { ${OIDC_PROVIDER_SAFE_FIELDS} }
    }`,
    z.object({ id }).strict(),
    "sensitive",
    "Get one OIDC provider configuration without its client secret.",
  ),
  query(
    "UnraidV4371QueryOidcConfiguration",
    "oidcConfiguration",
    `query UnraidV4371QueryOidcConfiguration {
      oidcConfiguration {
        providers { ${OIDC_PROVIDER_SAFE_FIELDS} }
        defaultAllowedOrigins
      }
    }`,
    null,
    "sensitive",
    "Get safe OIDC configuration and redirect origins without client secrets.",
  ),
  query(
    "UnraidV4371QueryValidateOidcSession",
    "validateOidcSession",
    `query UnraidV4371QueryValidateOidcSession($token: String!) {
      validateOidcSession(token: $token) { valid username }
    }`,
    z.object({ token: z.string().min(1) }).strict(),
    "sensitive",
    "Validate an OIDC session token; the input must be handled as a secret.",
    true,
  ),
  query(
    "UnraidV4371QueryMetrics",
    "metrics",
    `query UnraidV4371QueryMetrics {
      metrics {
        id
        cpu {
          id percentTotal
          cpus { percentTotal percentUser percentSystem percentNice percentIdle percentIrq percentGuest percentSteal }
        }
        memory {
          id total used free available active buffcache percentTotal
          swapTotal swapUsed swapFree percentSwapTotal
        }
        temperature {
          id
          sensors {
            id name type location warning critical
            current { value unit timestamp status }
            min { value unit timestamp status }
            max { value unit timestamp status }
          }
          summary {
            average warningCount criticalCount
            hottest { id name type location current { value unit timestamp status } }
            coolest { id name type location current { value unit timestamp status } }
          }
        }
        network {
          id name operstate bytesReceived bytesSent packetsReceived packetsSent
          receiveErrors transmitErrors receiveDropped transmitDropped rxSec txSec
          utilizationPercent lastUpdated
        }
      }
    }`,
    null,
    "read",
    "Get CPU, memory, temperature, and network metrics without unbounded temperature history.",
  ),
  query(
    "UnraidV4371QuerySystemTime",
    "systemTime",
    "query UnraidV4371QuerySystemTime { systemTime { currentTime timeZone useNtp ntpServers } }",
    null,
    "sensitive",
    "Get system time, timezone, and configured NTP servers.",
  ),
  query(
    "UnraidV4371QueryTimeZoneOptions",
    "timeZoneOptions",
    "query UnraidV4371QueryTimeZoneOptions { timeZoneOptions { value label } }",
    null,
    "read",
    "List selectable system timezones.",
  ),
  query(
    "UnraidV4371QueryUpsDevices",
    "upsDevices",
    `query UnraidV4371QueryUpsDevices { upsDevices { ${UPS_DEVICE_FIELDS} } }`,
    null,
    "read",
    "List UPS state, battery health, runtime, voltage, load, and power.",
  ),
  query(
    "UnraidV4371QueryUpsDeviceById",
    "upsDeviceById",
    `query UnraidV4371QueryUpsDeviceById($id: String!) {
      upsDeviceById(id: $id) { ${UPS_DEVICE_FIELDS} }
    }`,
    z.object({ id }).strict(),
    "read",
    "Get one UPS device by its schema-defined string ID.",
  ),
  query(
    "UnraidV4371QueryUpsConfiguration",
    "upsConfiguration",
    `query UnraidV4371QueryUpsConfiguration {
      upsConfiguration {
        service upsCable customUpsCable upsType device overrideUpsCapacity batteryLevel
        minutes timeout killUps nisIp netServer upsName modelName
      }
    }`,
    null,
    "sensitive",
    "Get UPS service, connection, network, and shutdown configuration.",
  ),
  query(
    "UnraidV4371QueryPluginInstallOperation",
    "pluginInstallOperation",
    `query UnraidV4371QueryPluginInstallOperation($operationId: ID!) {
      pluginInstallOperation(operationId: $operationId) { ${PLUGIN_INSTALL_FIELDS} output }
    }`,
    z.object({ operationId: id }).strict(),
    "sensitive",
    "Get one tracked plugin installation including its capped output.",
  ),
  query(
    "UnraidV4371QueryPluginInstallOperations",
    "pluginInstallOperations",
    `query UnraidV4371QueryPluginInstallOperations {
      pluginInstallOperations { ${PLUGIN_INSTALL_FIELDS} }
    }`,
    null,
    "sensitive",
    "List tracked plugin installations without command output.",
  ),
  query(
    "UnraidV4371QueryInstalledUnraidPlugins",
    "installedUnraidPlugins",
    "query UnraidV4371QueryInstalledUnraidPlugins { installedUnraidPlugins }",
    null,
    "read",
    "List installed Unraid OS plugin filenames.",
  ),
  query(
    "UnraidV4371QueryPlugins",
    "plugins",
    "query UnraidV4371QueryPlugins { plugins { name version hasApiModule hasCliModule } }",
    null,
    "read",
    "List loaded API plugins and module capabilities.",
  ),
  query(
    "UnraidV4371QueryRemoteAccess",
    "remoteAccess",
    "query UnraidV4371QueryRemoteAccess { remoteAccess { accessType forwardType port } }",
    null,
    "sensitive",
    "Get remote-access exposure and port-forwarding configuration.",
  ),
  query(
    "UnraidV4371QueryConnect",
    "connect",
    `query UnraidV4371QueryConnect {
      connect {
        id dynamicRemoteAccess { enabledType runningType error }
        settings { id values { accessType forwardType port } }
      }
    }`,
    null,
    "sensitive",
    "Get Unraid Connect status and safe settings values without form schemas.",
  ),
  query(
    "UnraidV4371QueryNetwork",
    "network",
    "query UnraidV4371QueryNetwork { network { id accessUrls { type name ipv4 ipv6 } } }",
    null,
    "sensitive",
    "Get configured LAN, WAN, WireGuard, mDNS, and other access URLs.",
  ),
  query(
    "UnraidV4371QueryCloud",
    "cloud",
    `query UnraidV4371QueryCloud {
      cloud {
        error apiKey { valid error } relay { status timeout error }
        minigraphql { status timeout error } cloud { status ip error } allowedOrigins
      }
    }`,
    null,
    "sensitive",
    "Get cloud connectivity and API-key validity without returning the key.",
  ),

  // Argument-bearing fields nested below the Docker root need dedicated fixed documents.
  query(
    "UnraidV4371QueryDockerContainer",
    "docker.container",
    `query UnraidV4371QueryDockerContainer($id: PrefixedID!) {
      docker { container(id: $id) { ${DOCKER_CONTAINER_SAFE_FIELDS} } }
    }`,
    z.object({ id }).strict(),
    "sensitive",
    "Get one Docker container with a safe, non-JSON projection.",
  ),
  query(
    "UnraidV4371QueryDockerLogs",
    "docker.logs",
    `query UnraidV4371QueryDockerLogs($id: PrefixedID!, $since: DateTime, $tail: Int) {
      docker {
        logs(id: $id, since: $since, tail: $tail) {
          containerId cursor lines { timestamp message }
        }
      }
    }`,
    z.object({
      id,
      since: z.iso.datetime({ offset: true }).optional(),
      tail: int.min(1).max(2_000).optional(),
    }).strict(),
    "sensitive",
    "Read bounded timestamped logs from one Docker container.",
  ),
  query(
    "UnraidV4371QueryDockerTailscaleStatus",
    "docker.container.tailscaleStatus",
    `query UnraidV4371QueryDockerTailscaleStatus($id: PrefixedID!, $forceRefresh: Boolean) {
      docker {
        container(id: $id) {
          id names
          tailscaleStatus(forceRefresh: $forceRefresh) {
            online version latestVersion updateAvailable hostname dnsName relay relayName
            tailscaleIps primaryRoutes isExitNode
            exitNodeStatus { online tailscaleIps }
            webUiUrl keyExpiry keyExpiryDays keyExpired backendState
          }
        }
      }
    }`,
    z.object({ id, forceRefresh: z.boolean().optional() }).strict(),
    "sensitive",
    "Get Tailscale status for one container without returning its authentication URL.",
  ),
];

const mutationOperations: UnraidApiOperation[] = [
  mutation(
    "UnraidV4371CreateNotification",
    "createNotification",
    `mutation UnraidV4371CreateNotification($input: NotificationData!) {
      createNotification(input: $input) { ${NOTIFICATION_FIELDS} }
    }`,
    z.object({ input: notificationData }).strict(),
    "routine",
    "Create a notification record.",
  ),
  mutation(
    "UnraidV4371DeleteNotification",
    "deleteNotification",
    `mutation UnraidV4371DeleteNotification($id: PrefixedID!, $type: NotificationType!) {
      deleteNotification(id: $id, type: $type) { ${NOTIFICATION_OVERVIEW_FIELDS} }
    }`,
    z.object({ id, type: notificationType }).strict(),
    "destructive",
    "Delete one unread or archived notification.",
  ),
  mutation(
    "UnraidV4371DeleteArchivedNotifications",
    "deleteArchivedNotifications",
    `mutation UnraidV4371DeleteArchivedNotifications {
      deleteArchivedNotifications { ${NOTIFICATION_OVERVIEW_FIELDS} }
    }`,
    null,
    "destructive",
    "Delete every archived notification.",
  ),
  mutation(
    "UnraidV4371ArchiveNotification",
    "archiveNotification",
    `mutation UnraidV4371ArchiveNotification($id: PrefixedID!) {
      archiveNotification(id: $id) { ${NOTIFICATION_FIELDS} }
    }`,
    z.object({ id }).strict(),
    "routine",
    "Archive one notification.",
  ),
  mutation(
    "UnraidV4371ArchiveNotifications",
    "archiveNotifications",
    `mutation UnraidV4371ArchiveNotifications($ids: [PrefixedID!]!) {
      archiveNotifications(ids: $ids) { ${NOTIFICATION_OVERVIEW_FIELDS} }
    }`,
    z.object({ ids: z.array(id).min(1) }).strict(),
    "routine",
    "Archive selected notifications.",
  ),
  mutation(
    "UnraidV4371NotifyIfUnique",
    "notifyIfUnique",
    `mutation UnraidV4371NotifyIfUnique($input: NotificationData!) {
      notifyIfUnique(input: $input) { ${NOTIFICATION_FIELDS} }
    }`,
    z.object({ input: notificationData }).strict(),
    "routine",
    "Create a notification only when an equivalent unread record does not exist.",
  ),
  mutation(
    "UnraidV4371ArchiveAllNotifications",
    "archiveAll",
    `mutation UnraidV4371ArchiveAllNotifications($importance: NotificationImportance) {
      archiveAll(importance: $importance) { ${NOTIFICATION_OVERVIEW_FIELDS} }
    }`,
    z.object({ importance: notificationImportance.optional() }).strict(),
    "routine",
    "Archive all notifications, optionally restricted by importance.",
  ),
  mutation(
    "UnraidV4371UnreadNotification",
    "unreadNotification",
    `mutation UnraidV4371UnreadNotification($id: PrefixedID!) {
      unreadNotification(id: $id) { ${NOTIFICATION_FIELDS} }
    }`,
    z.object({ id }).strict(),
    "routine",
    "Move one archived notification back to unread.",
  ),
  mutation(
    "UnraidV4371UnarchiveNotifications",
    "unarchiveNotifications",
    `mutation UnraidV4371UnarchiveNotifications($ids: [PrefixedID!]!) {
      unarchiveNotifications(ids: $ids) { ${NOTIFICATION_OVERVIEW_FIELDS} }
    }`,
    z.object({ ids: z.array(id).min(1) }).strict(),
    "routine",
    "Move selected archived notifications back to unread.",
  ),
  mutation(
    "UnraidV4371UnarchiveAllNotifications",
    "unarchiveAll",
    `mutation UnraidV4371UnarchiveAllNotifications($importance: NotificationImportance) {
      unarchiveAll(importance: $importance) { ${NOTIFICATION_OVERVIEW_FIELDS} }
    }`,
    z.object({ importance: notificationImportance.optional() }).strict(),
    "routine",
    "Move all archived notifications, optionally restricted by importance, back to unread.",
  ),
  mutation(
    "UnraidV4371RecalculateNotificationOverview",
    "recalculateOverview",
    `mutation UnraidV4371RecalculateNotificationOverview {
      recalculateOverview { ${NOTIFICATION_OVERVIEW_FIELDS} }
    }`,
    null,
    "routine",
    "Re-read notifications and recompute cached overview counts.",
  ),

  mutation(
    "UnraidV4371StartArray",
    "array.setState",
    `mutation UnraidV4371StartArray($decryptionPassword: String, $decryptionKeyfile: String) {
      array {
        setState(input: {
          desiredState: START
          decryptionPassword: $decryptionPassword
          decryptionKeyfile: $decryptionKeyfile
        }) { ${ARRAY_FIELDS} }
      }
    }`,
    z.object({
      decryptionPassword: z.string().min(1).optional(),
      decryptionKeyfile: z.string().min(1).optional(),
    }).strict(),
    "sensitive",
    "Start the array, optionally supplying an encrypted-disk password or keyfile.",
  ),
  mutation(
    "UnraidV4371StopArray",
    "array.setState",
    `mutation UnraidV4371StopArray {
      array { setState(input: { desiredState: STOP }) { ${ARRAY_FIELDS} } }
    }`,
    null,
    "destructive",
    "Stop the array, disrupting storage-backed services.",
  ),
  mutation(
    "UnraidV4371AddDiskToArray",
    "array.addDiskToArray",
    `mutation UnraidV4371AddDiskToArray($input: ArrayDiskInput!) {
      array { addDiskToArray(input: $input) { ${ARRAY_FIELDS} } }
    }`,
    z.object({ input: arrayDiskInput }).strict(),
    "destructive",
    "Assign a disk to an array slot; incorrect assignment can cause data loss.",
  ),
  mutation(
    "UnraidV4371RemoveDiskFromArray",
    "array.removeDiskFromArray",
    `mutation UnraidV4371RemoveDiskFromArray($input: ArrayDiskInput!) {
      array { removeDiskFromArray(input: $input) { ${ARRAY_FIELDS} } }
    }`,
    z.object({ input: arrayDiskInput }).strict(),
    "destructive",
    "Remove a disk assignment while the array is stopped.",
  ),
  mutation(
    "UnraidV4371MountArrayDisk",
    "array.mountArrayDisk",
    `mutation UnraidV4371MountArrayDisk($id: PrefixedID!) {
      array { mountArrayDisk(id: $id) { ${ARRAY_DISK_FIELDS} } }
    }`,
    z.object({ id }).strict(),
    "routine",
    "Mount one array disk.",
  ),
  mutation(
    "UnraidV4371UnmountArrayDisk",
    "array.unmountArrayDisk",
    `mutation UnraidV4371UnmountArrayDisk($id: PrefixedID!) {
      array { unmountArrayDisk(id: $id) { ${ARRAY_DISK_FIELDS} } }
    }`,
    z.object({ id }).strict(),
    "destructive",
    "Unmount one array disk, disrupting access to its filesystem.",
  ),
  mutation(
    "UnraidV4371ClearArrayDiskStatistics",
    "array.clearArrayDiskStatistics",
    `mutation UnraidV4371ClearArrayDiskStatistics($id: PrefixedID!) {
      array { clearArrayDiskStatistics(id: $id) }
    }`,
    z.object({ id }).strict(),
    "routine",
    "Clear the accumulated I/O statistics for one array disk.",
  ),
];

const dockerContainerMutations = [
  ["Start", "start", "routine", "Start a Docker container."],
  ["Stop", "stop", "routine", "Stop a Docker container."],
  ["Restart", "restart", "routine", "Restart a Docker container."],
  ["Pause", "pause", "routine", "Pause a Docker container."],
  ["Unpause", "unpause", "routine", "Resume a paused Docker container."],
  ["Update", "updateContainer", "destructive", "Update a Docker container to its latest image."],
] as const;

for (const [operationWord, field, safety, description] of dockerContainerMutations) {
  const name = `UnraidV4371${operationWord}DockerContainer`;
  mutationOperations.push(
    mutation(
      name,
      `docker.${field}`,
      `mutation ${name}($id: PrefixedID!) {
        docker { ${field}(id: $id) { ${DOCKER_CONTAINER_SAFE_FIELDS} } }
      }`,
      z.object({ id }).strict(),
      safety,
      description,
    ),
  );
}

mutationOperations.push(
  mutation(
    "UnraidV4371RemoveDockerContainer",
    "docker.removeContainer",
    `mutation UnraidV4371RemoveDockerContainer($id: PrefixedID!, $withImage: Boolean) {
      docker { removeContainer(id: $id, withImage: $withImage) }
    }`,
    z.object({ id, withImage: z.boolean().optional() }).strict(),
    "destructive",
    "Remove a Docker container and optionally its image.",
  ),
  mutation(
    "UnraidV4371UpdateDockerAutostartConfiguration",
    "docker.updateAutostartConfiguration",
    `mutation UnraidV4371UpdateDockerAutostartConfiguration(
      $entries: [DockerAutostartEntryInput!]!
      $persistUserPreferences: Boolean
    ) {
      docker {
        updateAutostartConfiguration(
          entries: $entries
          persistUserPreferences: $persistUserPreferences
        )
      }
    }`,
    z.object({
      entries: z.array(dockerAutostartEntry),
      persistUserPreferences: z.boolean().optional(),
    }).strict(),
    "routine",
    "Replace Docker autostart ordering, flags, and waits.",
  ),
  mutation(
    "UnraidV4371UpdateDockerContainers",
    "docker.updateContainers",
    `mutation UnraidV4371UpdateDockerContainers($ids: [PrefixedID!]!) {
      docker { updateContainers(ids: $ids) { ${DOCKER_CONTAINER_SAFE_FIELDS} } }
    }`,
    z.object({ ids: z.array(id).min(1) }).strict(),
    "destructive",
    "Update selected Docker containers to their latest images.",
  ),
  mutation(
    "UnraidV4371UpdateAllDockerContainers",
    "docker.updateAllContainers",
    `mutation UnraidV4371UpdateAllDockerContainers {
      docker { updateAllContainers { ${DOCKER_CONTAINER_SAFE_FIELDS} } }
    }`,
    null,
    "destructive",
    "Update every Docker container with an available image update.",
  ),
);

const vmMutations = [
  ["Start", "start", "routine", "Start a virtual machine."],
  ["Stop", "stop", "routine", "Gracefully stop a virtual machine."],
  ["Pause", "pause", "routine", "Pause a virtual machine."],
  ["Resume", "resume", "routine", "Resume a paused virtual machine."],
  ["ForceStop", "forceStop", "destructive", "Force-stop a virtual machine without a graceful shutdown."],
  ["Reboot", "reboot", "routine", "Reboot a virtual machine."],
  ["Reset", "reset", "destructive", "Hard-reset a virtual machine."],
] as const;

for (const [operationWord, field, safety, description] of vmMutations) {
  const name = `UnraidV4371${operationWord}Vm`;
  mutationOperations.push(
    mutation(
      name,
      `vm.${field}`,
      `mutation ${name}($id: PrefixedID!) { vm { ${field}(id: $id) } }`,
      z.object({ id }).strict(),
      safety,
      description,
    ),
  );
}

mutationOperations.push(
  mutation(
    "UnraidV4371CreateApiKey",
    "apiKey.create",
    `mutation UnraidV4371CreateApiKey($input: CreateApiKeyInput!) {
      apiKey { create(input: $input) { ${API_KEY_CREATED_FIELDS} } }
    }`,
    z.object({
      input: z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        roles: z.array(role).optional(),
        permissions: z.array(permissionInput).optional(),
        overwrite: z.boolean().optional(),
      }).strict(),
    }).strict(),
    "sensitive",
    "Create an API key and return its generated key material once under the sensitive-operation gate.",
  ),
  mutation(
    "UnraidV4371AddApiKeyRole",
    "apiKey.addRole",
    `mutation UnraidV4371AddApiKeyRole($input: AddRoleForApiKeyInput!) {
      apiKey { addRole(input: $input) }
    }`,
    z.object({ input: z.object({ apiKeyId: id, role }).strict() }).strict(),
    "sensitive",
    "Grant a role to an API key.",
  ),
  mutation(
    "UnraidV4371RemoveApiKeyRole",
    "apiKey.removeRole",
    `mutation UnraidV4371RemoveApiKeyRole($input: RemoveRoleFromApiKeyInput!) {
      apiKey { removeRole(input: $input) }
    }`,
    z.object({ input: z.object({ apiKeyId: id, role }).strict() }).strict(),
    "sensitive",
    "Remove a role from an API key.",
  ),
  mutation(
    "UnraidV4371DeleteApiKeys",
    "apiKey.delete",
    `mutation UnraidV4371DeleteApiKeys($input: DeleteApiKeyInput!) {
      apiKey { delete(input: $input) }
    }`,
    z.object({ input: z.object({ ids: z.array(id).min(1) }).strict() }).strict(),
    "sensitive",
    "Revoke and delete selected API keys.",
  ),
  mutation(
    "UnraidV4371UpdateApiKey",
    "apiKey.update",
    `mutation UnraidV4371UpdateApiKey($input: UpdateApiKeyInput!) {
      apiKey { update(input: $input) { ${API_KEY_SAFE_FIELDS} } }
    }`,
    z.object({
      input: z.object({
        id,
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        roles: z.array(role).optional(),
        permissions: z.array(permissionInput).optional(),
      }).strict(),
    }).strict(),
    "sensitive",
    "Update API key metadata and grants without returning key material.",
  ),
  mutation(
    "UnraidV4371SetTheme",
    "customization.setTheme",
    `mutation UnraidV4371SetTheme($theme: ThemeName!) {
      customization { setTheme(theme: $theme) { ${THEME_FIELDS} } }
    }`,
    z.object({ theme: themeName }).strict(),
    "routine",
    "Set the WebGUI theme.",
  ),
  mutation(
    "UnraidV4371SetLocale",
    "customization.setLocale",
    `mutation UnraidV4371SetLocale($locale: String!) {
      customization { setLocale(locale: $locale) }
    }`,
    z.object({ locale: z.string().min(1) }).strict(),
    "routine",
    "Set the display locale.",
  ),
  mutation(
    "UnraidV4371StartParityCheck",
    "parityCheck.start",
    `mutation UnraidV4371StartParityCheck {
      parityCheck { start(correct: false) }
    }`,
    null,
    "routine",
    "Start a non-correcting WIP parity check.",
  ),
  mutation(
    "UnraidV4371StartCorrectingParityCheck",
    "parityCheck.start",
    `mutation UnraidV4371StartCorrectingParityCheck {
      parityCheck { start(correct: true) }
    }`,
    null,
    "destructive",
    "Start a correcting WIP parity check that can write parity data.",
  ),
  mutation(
    "UnraidV4371PauseParityCheck",
    "parityCheck.pause",
    "mutation UnraidV4371PauseParityCheck { parityCheck { pause } }",
    null,
    "routine",
    "Pause the active parity check.",
  ),
  mutation(
    "UnraidV4371ResumeParityCheck",
    "parityCheck.resume",
    "mutation UnraidV4371ResumeParityCheck { parityCheck { resume } }",
    null,
    "routine",
    "Resume the paused parity check.",
  ),
  mutation(
    "UnraidV4371CancelParityCheck",
    "parityCheck.cancel",
    "mutation UnraidV4371CancelParityCheck { parityCheck { cancel } }",
    null,
    "destructive",
    "Cancel the active parity check before completion.",
  ),
  mutation(
    "UnraidV4371CreateRcloneRemote",
    "rclone.createRCloneRemote",
    `mutation UnraidV4371CreateRcloneRemote($input: CreateRCloneRemoteInput!) {
      rclone { createRCloneRemote(input: $input) { name type } }
    }`,
    z.object({
      input: z.object({ name: z.string().min(1), type: z.string().min(1), parameters: json }).strict(),
    }).strict(),
    "sensitive",
    "Create an rclone remote from provider-defined JSON parameters; omit its resulting configuration.",
  ),
  mutation(
    "UnraidV4371DeleteRcloneRemote",
    "rclone.deleteRCloneRemote",
    `mutation UnraidV4371DeleteRcloneRemote($input: DeleteRCloneRemoteInput!) {
      rclone { deleteRCloneRemote(input: $input) }
    }`,
    z.object({ input: z.object({ name: z.string().min(1) }).strict() }).strict(),
    "destructive",
    "Delete an rclone remote configuration.",
  ),
);

const onboardingNoInputMutations = [
  ["CompleteOnboarding", "completeOnboarding", "routine", "Mark onboarding complete."],
  ["ResetOnboarding", "resetOnboarding", "destructive", "Reset persisted onboarding progress for testing."],
  ["OpenOnboarding", "openOnboarding", "routine", "Force the onboarding modal open."],
  ["CloseOnboarding", "closeOnboarding", "routine", "Close the onboarding modal."],
  ["BypassOnboarding", "bypassOnboarding", "sensitive", "Temporarily bypass onboarding in API memory."],
  ["ResumeOnboarding", "resumeOnboarding", "routine", "Clear the temporary onboarding bypass."],
  ["ClearOnboardingOverride", "clearOnboardingOverride", "routine", "Clear testing overrides and reload onboarding state from disk."],
] as const;

for (const [operationWord, field, safety, description] of onboardingNoInputMutations) {
  const name = `UnraidV4371${operationWord}`;
  mutationOperations.push(
    mutation(
      name,
      `onboarding.${field}`,
      `mutation ${name} { onboarding { ${field} { ${ONBOARDING_SAFE_FIELDS} } } }`,
      null,
      safety,
      description,
    ),
  );
}

mutationOperations.push(
  mutation(
    "UnraidV4371SetOnboardingOverride",
    "onboarding.setOnboardingOverride",
    `mutation UnraidV4371SetOnboardingOverride($input: OnboardingOverrideInput!) {
      onboarding { setOnboardingOverride(input: $input) { ${ONBOARDING_SAFE_FIELDS} } }
    }`,
    z.object({ input: onboardingOverrideInput }).strict(),
    "sensitive",
    "Set in-memory onboarding, activation, partner, or registration overrides for testing.",
  ),
  mutation(
    "UnraidV4371CreateInternalBootPool",
    "onboarding.createInternalBootPool",
    `mutation UnraidV4371CreateInternalBootPool($input: CreateInternalBootPoolInput!) {
      onboarding { createInternalBootPool(input: $input) { ok code output } }
    }`,
    z.object({
      input: z.object({
        poolName: z.string().min(1),
        devices: z.array(z.string().min(1)).min(1),
        bootSizeMiB: int.positive(),
        updateBios: z.boolean(),
        reboot: z.boolean().optional(),
      }).strict(),
    }).strict(),
    "destructive",
    "Create and configure an internal boot pool, optionally updating BIOS and rebooting.",
  ),
  mutation(
    "UnraidV4371RefreshInternalBootContext",
    "onboarding.refreshInternalBootContext",
    `mutation UnraidV4371RefreshInternalBootContext {
      onboarding { refreshInternalBootContext { ${INTERNAL_BOOT_CONTEXT_FIELDS} } }
    }`,
    null,
    "routine",
    "Refresh the internal-boot context from current emhttp state.",
  ),
  mutation(
    "UnraidV4371InstallUnraidPlugin",
    "unraidPlugins.installPlugin",
    `mutation UnraidV4371InstallUnraidPlugin($input: InstallPluginInput!) {
      unraidPlugins { installPlugin(input: $input) { ${PLUGIN_INSTALL_FIELDS} } }
    }`,
    z.object({ input: pluginInstallInput }).strict(),
    "sensitive",
    "Install executable Unraid plugin code from a URL and return its tracked operation.",
  ),
  mutation(
    "UnraidV4371InstallUnraidLanguage",
    "unraidPlugins.installLanguage",
    `mutation UnraidV4371InstallUnraidLanguage($input: InstallPluginInput!) {
      unraidPlugins { installLanguage(input: $input) { ${PLUGIN_INSTALL_FIELDS} } }
    }`,
    z.object({ input: pluginInstallInput }).strict(),
    "sensitive",
    "Install an Unraid language pack from a URL and return its tracked operation.",
  ),
);

const organizerMutations: readonly [
  name: string,
  field: string,
  declaration: string,
  invocation: string,
  inputSchema: z.ZodObject | null,
  safety: UnraidSafetyClass,
  description: string,
][] = [
  [
    "UnraidV4371CreateDockerFolder",
    "createDockerFolder",
    "($name: String!, $parentId: String, $childrenIds: [String!])",
    "(name: $name, parentId: $parentId, childrenIds: $childrenIds)",
    z.object({
      name: z.string().min(1),
      parentId: z.string().optional(),
      childrenIds: z.array(z.string()).optional(),
    }).strict(),
    "routine",
    "Create a Docker organizer folder.",
  ],
  [
    "UnraidV4371SetDockerFolderChildren",
    "setDockerFolderChildren",
    "($folderId: String, $childrenIds: [String!]!)",
    "(folderId: $folderId, childrenIds: $childrenIds)",
    z.object({ folderId: z.string().optional(), childrenIds: z.array(z.string()) }).strict(),
    "routine",
    "Replace a Docker organizer folder's children.",
  ],
  [
    "UnraidV4371DeleteDockerEntries",
    "deleteDockerEntries",
    "($entryIds: [String!]!)",
    "(entryIds: $entryIds)",
    z.object({ entryIds: z.array(z.string()).min(1) }).strict(),
    "destructive",
    "Delete Docker organizer entries.",
  ],
  [
    "UnraidV4371MoveDockerEntriesToFolder",
    "moveDockerEntriesToFolder",
    "($sourceEntryIds: [String!]!, $destinationFolderId: String!)",
    "(sourceEntryIds: $sourceEntryIds, destinationFolderId: $destinationFolderId)",
    z.object({
      sourceEntryIds: z.array(z.string()).min(1),
      destinationFolderId: z.string().min(1),
    }).strict(),
    "routine",
    "Move Docker organizer entries into a folder.",
  ],
  [
    "UnraidV4371MoveDockerItemsToPosition",
    "moveDockerItemsToPosition",
    "($sourceEntryIds: [String!]!, $destinationFolderId: String!, $position: Float!)",
    "(sourceEntryIds: $sourceEntryIds, destinationFolderId: $destinationFolderId, position: $position)",
    z.object({
      sourceEntryIds: z.array(z.string()).min(1),
      destinationFolderId: z.string().min(1),
      position: z.number(),
    }).strict(),
    "routine",
    "Move Docker organizer entries to a position in a folder.",
  ],
  [
    "UnraidV4371RenameDockerFolder",
    "renameDockerFolder",
    "($folderId: String!, $newName: String!)",
    "(folderId: $folderId, newName: $newName)",
    z.object({ folderId: z.string().min(1), newName: z.string().min(1) }).strict(),
    "routine",
    "Rename a Docker organizer folder.",
  ],
  [
    "UnraidV4371CreateDockerFolderWithItems",
    "createDockerFolderWithItems",
    "($name: String!, $parentId: String, $sourceEntryIds: [String!], $position: Float)",
    "(name: $name, parentId: $parentId, sourceEntryIds: $sourceEntryIds, position: $position)",
    z.object({
      name: z.string().min(1),
      parentId: z.string().optional(),
      sourceEntryIds: z.array(z.string()).optional(),
      position: z.number().optional(),
    }).strict(),
    "routine",
    "Create a Docker organizer folder and move selected entries into it.",
  ],
  [
    "UnraidV4371UpdateDockerViewPreferences",
    "updateDockerViewPreferences",
    "($viewId: String, $prefs: JSON!)",
    "(viewId: $viewId, prefs: $prefs)",
    z.object({ viewId: z.string().optional(), prefs: json }).strict(),
    "sensitive",
    "Update provider-defined Docker organizer view preferences.",
  ],
];

for (const [name, field, declaration, invocation, inputSchema, safety, description] of organizerMutations) {
  mutationOperations.push(
    mutation(
      name,
      field,
      `mutation ${name}${declaration} { ${field}${invocation} { ${ORGANIZER_SAFE_FIELDS} } }`,
      inputSchema,
      safety,
      description,
    ),
  );
}

const temperatureConfigInput = z
  .object({
    enabled: z.boolean().optional(),
    polling_interval: int.positive().optional(),
    default_unit: z.enum(["CELSIUS", "FAHRENHEIT", "KELVIN", "RANKINE"]).optional(),
    sensors: z
      .object({
        lm_sensors: z
          .object({ enabled: z.boolean().optional(), config_path: z.string().optional() })
          .strict()
          .optional(),
        smartctl: z.object({ enabled: z.boolean().optional() }).strict().optional(),
        ipmi: z
          .object({ enabled: z.boolean().optional(), args: z.array(z.string()).optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    thresholds: z
      .object({
        cpu_warning: int.optional(),
        cpu_critical: int.optional(),
        disk_warning: int.optional(),
        disk_critical: int.optional(),
        warning: int.optional(),
        critical: int.optional(),
      })
      .strict()
      .optional(),
    history: z
      .object({ max_readings: int.positive().optional(), retention_ms: int.positive().optional() })
      .strict()
      .optional(),
  })
  .strict();
const upsConfigInput = z
  .object({
    service: z.enum(["ENABLE", "DISABLE"]).optional(),
    upsCable: z.enum(["USB", "SIMPLE", "SMART", "ETHER", "CUSTOM"]).optional(),
    customUpsCable: z.string().optional(),
    upsType: z.enum(["USB", "APCSMART", "NET", "SNMP", "DUMB", "PCNET", "MODBUS"]).optional(),
    device: z.string().optional(),
    overrideUpsCapacity: int.nonnegative().optional(),
    batteryLevel: int.min(0).max(100).optional(),
    minutes: int.nonnegative().optional(),
    timeout: int.nonnegative().optional(),
    killUps: z.enum(["YES", "NO"]).optional(),
  })
  .strict();

mutationOperations.push(
  mutation(
    "UnraidV4371UpdateServerIdentity",
    "updateServerIdentity",
    `mutation UnraidV4371UpdateServerIdentity($name: String!, $comment: String, $sysModel: String) {
      updateServerIdentity(name: $name, comment: $comment, sysModel: $sysModel) {
        id owner { id username url avatar } guid name comment status wanip lanip localurl remoteurl
      }
    }`,
    z.object({
      name: z.string().min(1),
      comment: z.string().optional(),
      sysModel: z.string().optional(),
    }).strict(),
    "sensitive",
    "Update server name, comment, and model; omit the server API key from the response.",
  ),
  mutation(
    "UnraidV4371UpdateSshSettings",
    "updateSshSettings",
    `mutation UnraidV4371UpdateSshSettings($input: UpdateSshInput!) {
      updateSshSettings(input: $input) { id useSsh portssh }
    }`,
    z.object({
      input: z.object({ enabled: z.boolean(), port: int.min(1).max(65_535) }).strict(),
    }).strict(),
    "sensitive",
    "Enable or disable SSH and set its listening port.",
  ),
  mutation(
    "UnraidV4371SyncDockerTemplatePaths",
    "syncDockerTemplatePaths",
    `mutation UnraidV4371SyncDockerTemplatePaths {
      syncDockerTemplatePaths { scanned matched skipped errors }
    }`,
    null,
    "routine",
    "Synchronize Docker container-to-template path mappings.",
  ),
  mutation(
    "UnraidV4371ResetDockerTemplateMappings",
    "resetDockerTemplateMappings",
    "mutation UnraidV4371ResetDockerTemplateMappings { resetDockerTemplateMappings }",
    null,
    "destructive",
    "Reset Docker template mappings to defaults.",
  ),
  mutation(
    "UnraidV4371RefreshDockerDigests",
    "refreshDockerDigests",
    "mutation UnraidV4371RefreshDockerDigests { refreshDockerDigests }",
    null,
    "routine",
    "Refresh Docker image digests and update availability.",
  ),
  mutation(
    "UnraidV4371InitiateFlashBackup",
    "initiateFlashBackup",
    `mutation UnraidV4371InitiateFlashBackup($input: InitiateFlashBackupInput!) {
      initiateFlashBackup(input: $input) { status jobId }
    }`,
    z.object({
      input: z.object({
        remoteName: z.string().min(1),
        sourcePath: z.string().min(1),
        destinationPath: z.string().min(1),
        options: json.optional(),
      }).strict(),
    }).strict(),
    "sensitive",
    "Start a flash backup using schema-defined paths and optional rclone JSON options.",
  ),
  mutation(
    "UnraidV4371UpdateSettings",
    "updateSettings",
    `mutation UnraidV4371UpdateSettings($input: JSON!) {
      updateSettings(input: $input) { restartRequired warnings }
    }`,
    z.object({ input: json }).strict(),
    "sensitive",
    "Apply unified JSON settings while omitting potentially secret-bearing values from the response.",
  ),
  mutation(
    "UnraidV4371UpdateTemperatureConfig",
    "updateTemperatureConfig",
    `mutation UnraidV4371UpdateTemperatureConfig($input: TemperatureConfigInput!) {
      updateTemperatureConfig(input: $input)
    }`,
    z.object({ input: temperatureConfigInput }).strict(),
    "routine",
    "Update temperature polling, sensors, thresholds, and history retention.",
  ),
  mutation(
    "UnraidV4371UpdateSystemTime",
    "updateSystemTime",
    `mutation UnraidV4371UpdateSystemTime($input: UpdateSystemTimeInput!) {
      updateSystemTime(input: $input) { currentTime timeZone useNtp ntpServers }
    }`,
    z.object({
      input: z.object({
        timeZone: z.string().min(1).optional(),
        useNtp: z.boolean().optional(),
        ntpServers: z.array(z.string()).max(4).optional(),
        manualDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional(),
      }).strict(),
    }).strict(),
    "sensitive",
    "Update timezone, NTP servers, synchronization mode, or manual system time.",
  ),
  mutation(
    "UnraidV4371ConfigureUps",
    "configureUps",
    "mutation UnraidV4371ConfigureUps($config: UPSConfigInput!) { configureUps(config: $config) }",
    z.object({ config: upsConfigInput }).strict(),
    "sensitive",
    "Configure UPS connectivity and automatic-shutdown thresholds.",
  ),
  mutation(
    "UnraidV4371AddApiPlugin",
    "addPlugin",
    `mutation UnraidV4371AddApiPlugin($input: PluginManagementInput!) { addPlugin(input: $input) }`,
    z.object({
      input: z.object({
        names: z.array(z.string().min(1)).min(1),
        bundled: z.boolean().optional(),
        restart: z.boolean().optional(),
      }).strict(),
    }).strict(),
    "sensitive",
    "Add executable API plugins and optionally restart the API.",
  ),
  mutation(
    "UnraidV4371RemoveApiPlugin",
    "removePlugin",
    `mutation UnraidV4371RemoveApiPlugin($input: PluginManagementInput!) { removePlugin(input: $input) }`,
    z.object({
      input: z.object({
        names: z.array(z.string().min(1)).min(1),
        bundled: z.boolean().optional(),
        restart: z.boolean().optional(),
      }).strict(),
    }).strict(),
    "destructive",
    "Remove API plugins and optionally restart the API.",
  ),
  mutation(
    "UnraidV4371UpdateConnectSettings",
    "updateApiSettings",
    `mutation UnraidV4371UpdateConnectSettings($input: ConnectSettingsInput!) {
      updateApiSettings(input: $input) { accessType forwardType port }
    }`,
    z.object({
      input: z.object({
        accessType: wanAccessType.optional(),
        forwardType: wanForwardType.optional(),
        port: int.min(1).max(65_535).optional(),
      }).strict(),
    }).strict(),
    "sensitive",
    "Update Unraid Connect WAN exposure and forwarding settings.",
  ),
  mutation(
    "UnraidV4371ConnectSignIn",
    "connectSignIn",
    `mutation UnraidV4371ConnectSignIn($input: ConnectSignInInput!) {
      connectSignIn(input: $input)
    }`,
    z.object({
      input: z.object({
        apiKey: z.string().min(1),
        userInfo: z
          .object({
            preferred_username: z.string().min(1),
            email: z.email(),
            avatar: z.string().optional(),
          })
          .strict()
          .optional(),
      }).strict(),
    }).strict(),
    "sensitive",
    "Sign in to Unraid Connect using an API key and optional profile metadata.",
  ),
  mutation(
    "UnraidV4371ConnectSignOut",
    "connectSignOut",
    "mutation UnraidV4371ConnectSignOut { connectSignOut }",
    null,
    "sensitive",
    "Sign out of Unraid Connect.",
  ),
  mutation(
    "UnraidV4371SetupRemoteAccess",
    "setupRemoteAccess",
    `mutation UnraidV4371SetupRemoteAccess($input: SetupRemoteAccessInput!) {
      setupRemoteAccess(input: $input)
    }`,
    z.object({
      input: z.object({
        accessType: wanAccessType,
        forwardType: wanForwardType.optional(),
        port: int.min(1).max(65_535).optional(),
      }).strict(),
    }).strict(),
    "sensitive",
    "Configure public remote access and port forwarding.",
  ),
  mutation(
    "UnraidV4371EnableDynamicRemoteAccess",
    "enableDynamicRemoteAccess",
    `mutation UnraidV4371EnableDynamicRemoteAccess($input: EnableDynamicRemoteAccessInput!) {
      enableDynamicRemoteAccess(input: $input)
    }`,
    z.object({
      input: z.object({
        url: z.object({
          type: urlType,
          name: z.string().optional(),
          ipv4: z.url().optional(),
          ipv6: z.url().optional(),
        }).strict(),
        enabled: z.boolean(),
      }).strict(),
    }).strict(),
    "sensitive",
    "Enable or disable dynamic remote access for a fixed access URL.",
  ),
);

export const UNRAID_API_V4_37_1_ROOT_QUERY_FIELDS = Object.freeze([
  "apiKeys",
  "apiKey",
  "apiKeyPossibleRoles",
  "apiKeyPossiblePermissions",
  "getPermissionsForRoles",
  "previewEffectivePermissions",
  "getAvailableAuthActions",
  "getApiKeyCreationFormSchema",
  "config",
  "display",
  "flash",
  "me",
  "notifications",
  "online",
  "owner",
  "internalBootContext",
  "registration",
  "server",
  "servers",
  "services",
  "shares",
  "vars",
  "vms",
  "parityHistory",
  "array",
  "customization",
  "isFreshInstall",
  "publicTheme",
  "info",
  "networkInterfaces",
  "docker",
  "disks",
  "assignableDisks",
  "disk",
  "rclone",
  "logFiles",
  "logFile",
  "settings",
  "isSSOEnabled",
  "publicOidcProviders",
  "oidcProviders",
  "oidcProvider",
  "oidcConfiguration",
  "validateOidcSession",
  "metrics",
  "systemTime",
  "timeZoneOptions",
  "upsDevices",
  "upsDeviceById",
  "upsConfiguration",
  "pluginInstallOperation",
  "pluginInstallOperations",
  "installedUnraidPlugins",
  "plugins",
  "remoteAccess",
  "connect",
  "network",
  "cloud",
] as const);

export const UNRAID_API_V4_37_1_MUTATION_PATHS = Object.freeze([
  "createNotification",
  "deleteNotification",
  "deleteArchivedNotifications",
  "archiveNotification",
  "archiveNotifications",
  "notifyIfUnique",
  "archiveAll",
  "unreadNotification",
  "unarchiveNotifications",
  "unarchiveAll",
  "recalculateOverview",
  "array.setState",
  "array.addDiskToArray",
  "array.removeDiskFromArray",
  "array.mountArrayDisk",
  "array.unmountArrayDisk",
  "array.clearArrayDiskStatistics",
  "docker.start",
  "docker.stop",
  "docker.restart",
  "docker.pause",
  "docker.unpause",
  "docker.removeContainer",
  "docker.updateAutostartConfiguration",
  "docker.updateContainer",
  "docker.updateContainers",
  "docker.updateAllContainers",
  "vm.start",
  "vm.stop",
  "vm.pause",
  "vm.resume",
  "vm.forceStop",
  "vm.reboot",
  "vm.reset",
  "parityCheck.start",
  "parityCheck.pause",
  "parityCheck.resume",
  "parityCheck.cancel",
  "apiKey.create",
  "apiKey.addRole",
  "apiKey.removeRole",
  "apiKey.delete",
  "apiKey.update",
  "customization.setTheme",
  "customization.setLocale",
  "rclone.createRCloneRemote",
  "rclone.deleteRCloneRemote",
  "onboarding.completeOnboarding",
  "onboarding.resetOnboarding",
  "onboarding.openOnboarding",
  "onboarding.closeOnboarding",
  "onboarding.bypassOnboarding",
  "onboarding.resumeOnboarding",
  "onboarding.setOnboardingOverride",
  "onboarding.clearOnboardingOverride",
  "onboarding.createInternalBootPool",
  "onboarding.refreshInternalBootContext",
  "unraidPlugins.installPlugin",
  "unraidPlugins.installLanguage",
  "updateServerIdentity",
  "updateSshSettings",
  "createDockerFolder",
  "setDockerFolderChildren",
  "deleteDockerEntries",
  "moveDockerEntriesToFolder",
  "moveDockerItemsToPosition",
  "renameDockerFolder",
  "createDockerFolderWithItems",
  "updateDockerViewPreferences",
  "syncDockerTemplatePaths",
  "resetDockerTemplateMappings",
  "refreshDockerDigests",
  "initiateFlashBackup",
  "updateSettings",
  "updateTemperatureConfig",
  "updateSystemTime",
  "configureUps",
  "addPlugin",
  "removePlugin",
  "updateApiSettings",
  "connectSignIn",
  "connectSignOut",
  "setupRemoteAccess",
  "enableDynamicRemoteAccess",
] as const);

export const UNRAID_API_V4_37_1_OPERATIONS: readonly UnraidApiOperation[] = Object.freeze([
  ...queryOperations,
  ...mutationOperations,
]);

const subscriptionReason =
  "This is a long-lived GraphQL subscription rather than a bounded request/response operation; use the mapped snapshot query when one exists.";

export const UNRAID_API_V4_37_1_SUBSCRIPTIONS: readonly UnraidSubscriptionCatalogEntry[] =
  Object.freeze([
    {
      field: "displaySubscription",
      document: `subscription UnraidV4371DisplaySubscription {
        displaySubscription {
          id case { id url icon error } theme unit scale tabs resize wwn total usage text
          warning critical hot max locale
        }
      }`,
      inputSchema: null,
      safety: "read",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryDisplay",
      reason: subscriptionReason,
    },
    {
      field: "notificationAdded",
      document: `subscription UnraidV4371NotificationAdded {
        notificationAdded { ${NOTIFICATION_FIELDS} }
      }`,
      inputSchema: null,
      safety: "sensitive",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryNotifications",
      reason: subscriptionReason,
    },
    {
      field: "notificationsOverview",
      document: `subscription UnraidV4371NotificationsOverview {
        notificationsOverview { ${NOTIFICATION_OVERVIEW_FIELDS} }
      }`,
      inputSchema: null,
      safety: "sensitive",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryNotifications",
      reason: subscriptionReason,
    },
    {
      field: "notificationsWarningsAndAlerts",
      document: `subscription UnraidV4371NotificationsWarningsAndAlerts {
        notificationsWarningsAndAlerts { ${NOTIFICATION_FIELDS} }
      }`,
      inputSchema: null,
      safety: "sensitive",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryNotifications",
      reason: subscriptionReason,
    },
    {
      field: "ownerSubscription",
      document: `subscription UnraidV4371OwnerSubscription {
        ownerSubscription { username url avatar }
      }`,
      inputSchema: null,
      safety: "sensitive",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryOwner",
      reason: subscriptionReason,
    },
    {
      field: "serversSubscription",
      document: `subscription UnraidV4371ServersSubscription {
        serversSubscription {
          id owner { id username url avatar } guid name comment status
          wanip lanip localurl remoteurl
        }
      }`,
      inputSchema: null,
      safety: "sensitive",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryServers",
      reason: subscriptionReason,
    },
    {
      field: "parityHistorySubscription",
      document: `subscription UnraidV4371ParityHistorySubscription {
        parityHistorySubscription { ${PARITY_FIELDS} }
      }`,
      inputSchema: null,
      safety: "read",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryParityHistory",
      reason: subscriptionReason,
    },
    {
      field: "arraySubscription",
      document: `subscription UnraidV4371ArraySubscription {
        arraySubscription { ${ARRAY_FIELDS} }
      }`,
      inputSchema: null,
      safety: "read",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryArray",
      reason: subscriptionReason,
    },
    {
      field: "dockerContainerStats",
      document: `subscription UnraidV4371DockerContainerStats {
        dockerContainerStats { id cpuPercent memUsage memPercent netIO blockIO }
      }`,
      inputSchema: null,
      safety: "read",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: null,
      reason: `${subscriptionReason} The v4.37.1 Query root has no Docker stats snapshot field.`,
    },
    {
      field: "logFile",
      document: `subscription UnraidV4371LogFile($path: String!) {
        logFile(path: $path) { path content totalLines startLine }
      }`,
      inputSchema: z.object({ path: z.string().min(1) }).strict(),
      safety: "sensitive",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryLogFile",
      reason: subscriptionReason,
    },
    {
      field: "systemMetricsCpu",
      document: `subscription UnraidV4371SystemMetricsCpu {
        systemMetricsCpu {
          id percentTotal
          cpus { percentTotal percentUser percentSystem percentNice percentIdle percentIrq percentGuest percentSteal }
        }
      }`,
      inputSchema: null,
      safety: "read",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryMetrics",
      reason: subscriptionReason,
    },
    {
      field: "systemMetricsCpuTelemetry",
      document: `subscription UnraidV4371SystemMetricsCpuTelemetry {
        systemMetricsCpuTelemetry { id totalPower power temp }
      }`,
      inputSchema: null,
      safety: "read",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryInfo",
      reason: subscriptionReason,
    },
    {
      field: "systemMetricsMemory",
      document: `subscription UnraidV4371SystemMetricsMemory {
        systemMetricsMemory {
          id total used free available active buffcache percentTotal
          swapTotal swapUsed swapFree percentSwapTotal
        }
      }`,
      inputSchema: null,
      safety: "read",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryMetrics",
      reason: subscriptionReason,
    },
    {
      field: "systemMetricsNetwork",
      document: `subscription UnraidV4371SystemMetricsNetwork {
        systemMetricsNetwork {
          id name operstate bytesReceived bytesSent packetsReceived packetsSent
          receiveErrors transmitErrors receiveDropped transmitDropped rxSec txSec
          utilizationPercent lastUpdated
        }
      }`,
      inputSchema: null,
      safety: "read",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryMetrics",
      reason: subscriptionReason,
    },
    {
      field: "systemMetricsTemperature",
      document: `subscription UnraidV4371SystemMetricsTemperature {
        systemMetricsTemperature {
          id
          sensors {
            id name type location warning critical
            current { value unit timestamp status }
            min { value unit timestamp status }
            max { value unit timestamp status }
          }
          summary {
            average warningCount criticalCount
            hottest { id name type location current { value unit timestamp status } }
            coolest { id name type location current { value unit timestamp status } }
          }
        }
      }`,
      inputSchema: null,
      safety: "read",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryMetrics",
      reason: subscriptionReason,
    },
    {
      field: "upsUpdates",
      document: `subscription UnraidV4371UpsUpdates {
        upsUpdates { ${UPS_DEVICE_FIELDS} }
      }`,
      inputSchema: null,
      safety: "read",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryUpsDevices",
      reason: subscriptionReason,
    },
    {
      field: "pluginInstallUpdates",
      document: `subscription UnraidV4371PluginInstallUpdates($operationId: ID!) {
        pluginInstallUpdates(operationId: $operationId) {
          operationId status output timestamp
        }
      }`,
      inputSchema: z.object({ operationId: id }).strict(),
      safety: "sensitive",
      minApiVersion: UNRAID_API_CATALOG_VERSION,
      requestResponseMapping: "UnraidV4371QueryPluginInstallOperation",
      reason: subscriptionReason,
    },
  ]);

export const UNRAID_API_V4_37_1_GAPS: readonly UnraidCatalogGap[] = Object.freeze([
  {
    surface: "Secret-bearing output fields",
    fields: [
      "ApiKey.key",
      "Server.apikey",
      "Registration.keyFile",
      "Vars.csrfToken",
      "Vars.luksKeyfile",
      "OidcProvider.clientSecret",
      "OidcProvider.buttonIcon",
      "Onboarding.activationCode",
      "ActivationCode.code",
      "InfoDisplayCase.base64",
      "TailscaleStatus.authUrl",
    ],
    reason:
      "The fields exist in the official schema but are excluded from read projections so catalog responses do not disclose credentials, activation data, embedded images, or login URLs. Newly generated API-key material is returned only by the separately confirmed create operation.",
  },
  {
    surface: "Broad JSON output fields",
    fields: [
      "Settings.unified",
      "ApiKeyFormSettings.values",
      "ConnectSettings.dataSchema",
      "ConnectSettings.uiSchema",
      "DockerContainer.labels",
      "DockerContainer.networkSettings",
      "DockerContainer.mounts",
      "DockerNetwork.ipam",
      "DockerNetwork.containers",
      "DockerNetwork.options",
      "DockerNetwork.labels",
      "ResolvedOrganizerView.prefs",
      "RCloneDrive.options",
      "RCloneRemote.parameters",
      "RCloneRemote.config",
      "UpdateSettingsResponse.values",
      "TemperatureSensor.history",
    ],
    reason:
      "GraphQL exposes these as provider-defined JSON or potentially unbounded data. Fixed documents use narrower verified fields instead of inventing an object schema.",
  },
  {
    surface: "Broad JSON mutation inputs",
    fields: [
      "updateSettings.input",
      "updateDockerViewPreferences.prefs",
      "initiateFlashBackup.input.options",
      "createRCloneRemote.input.parameters",
      "RCloneConfigFormInput.parameters",
    ],
    reason:
      "The official v4.37.1 schema types these values only as JSON. Their Zod schemas therefore validate JSON-serializability, not an invented provider-specific shape, and the operations are marked sensitive.",
  },
  {
    surface: "Subscription-only snapshots",
    fields: ["dockerContainerStats"],
    reason:
      "The Query root has no equivalent Docker-container-stats snapshot. It is exposed through a bounded one-event subscription tool instead of a query operation.",
  },
]);
