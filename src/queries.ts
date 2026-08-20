export const SYSTEM_INFO_QUERY = /* GraphQL */ `
  query McpSystemInfo {
    info {
      time
      versions {
        core { unraid api kernel }
        packages { docker }
      }
      os {
        platform distro release kernel arch hostname fqdn uptime uefi
      }
      system {
        manufacturer model version virtual
      }
      cpu {
        manufacturer brand speed cores threads processors
      }
      memory {
        layout { size type clockSpeed manufacturer formFactor }
      }
    }
  }
`;

export const SYSTEM_INFO_COMPAT_QUERY = /* GraphQL */ `
  query McpSystemInfoCompat {
    info {
      time
      versions { unraid kernel docker }
      os { platform distro release kernel arch hostname uptime }
      system { manufacturer model version }
      cpu { manufacturer brand speed cores threads processors }
      memory { layout { size type clockSpeed manufacturer formFactor } }
    }
  }
`;

export const SYSTEM_NETWORK_QUERY = /* GraphQL */ `
  query McpSystemNetwork {
    info {
      networkInterfaces {
        name description macAddress speed duplex operstate type
        ipv4Addresses { address netmask }
        ipv6Addresses { address prefixLength }
      }
      primaryNetwork {
        name description macAddress speed duplex operstate type
        ipv4Addresses { address netmask }
        ipv6Addresses { address prefixLength }
      }
    }
  }
`;

export const SYSTEM_NETWORK_COMPAT_QUERY = /* GraphQL */ `
  query McpSystemNetworkCompat {
    info {
      networkInterfaces {
        name description macAddress status protocol ipAddress netmask gateway
        useDhcp ipv6Address ipv6Netmask ipv6Gateway useDhcp6
      }
      primaryNetwork {
        name description macAddress status protocol ipAddress netmask gateway
        useDhcp ipv6Address ipv6Netmask ipv6Gateway useDhcp6
      }
    }
  }
`;

export const METRICS_QUERY = /* GraphQL */ `
  query McpMetrics {
    metrics {
      cpu {
        percentTotal
        cpus { percentTotal percentUser percentSystem percentIdle }
      }
      memory {
        total used free available buffcache percentTotal
        swapTotal swapUsed swapFree percentSwapTotal
      }
    }
  }
`;

export const NETWORK_METRICS_QUERY = /* GraphQL */ `
  query McpNetworkMetrics {
    metrics {
      network {
        name operstate bytesReceived bytesSent packetsReceived packetsSent
        receiveErrors transmitErrors receiveDropped transmitDropped
        rxSec txSec utilizationPercent lastUpdated
      }
    }
  }
`;

export const TEMPERATURE_METRICS_QUERY = /* GraphQL */ `
  query McpTemperatureMetrics {
    metrics {
      temperature {
        sensors {
          id name type location warning critical
          current { value unit timestamp status }
        }
        summary {
          average warningCount criticalCount
          hottest { id name type location current { value unit timestamp status } }
          coolest { id name type location current { value unit timestamp status } }
        }
      }
    }
  }
`;

const ARRAY_DISK_FIELDS = /* GraphQL */ `
  id idx name device size status rotational temp numReads numWrites numErrors
  fsSize fsFree fsUsed exportable type warning critical fsType comment format
  transport color isSpinning
`;

const PARITY_FIELDS = /* GraphQL */ `
  date duration speed status errors progress correcting paused running
`;

export const ARRAY_QUERY = /* GraphQL */ `
  query McpArray {
    array {
      id state
      capacity {
        kilobytes { free used total }
        disks { free used total }
      }
      parityCheckStatus { ${PARITY_FIELDS} }
      boot { ${ARRAY_DISK_FIELDS} }
      bootDevices { ${ARRAY_DISK_FIELDS} }
      parities { ${ARRAY_DISK_FIELDS} }
      disks { ${ARRAY_DISK_FIELDS} }
      caches { ${ARRAY_DISK_FIELDS} }
    }
  }
`;

const ARRAY_DISK_COMPAT_FIELDS = /* GraphQL */ `
  id idx name device size status rotational temp numReads numWrites numErrors
  fsSize fsFree fsUsed exportable type warning critical fsType comment format
  transport color
`;

export const ARRAY_COMPAT_QUERY = /* GraphQL */ `
  query McpArrayCompat {
    array {
      id state
      capacity {
        kilobytes { free used total }
        disks { free used total }
      }
      parityCheckStatus { ${PARITY_FIELDS} }
      boot { ${ARRAY_DISK_COMPAT_FIELDS} }
      parities { ${ARRAY_DISK_COMPAT_FIELDS} }
      disks { ${ARRAY_DISK_COMPAT_FIELDS} }
      caches { ${ARRAY_DISK_COMPAT_FIELDS} }
    }
  }
`;

export const DISKS_QUERY = /* GraphQL */ `
  query McpDisks {
    disks {
      id device type name vendor size firmwareRevision serialNum
      interfaceType smartStatus temperature isSpinning
      partitions { name fsType size }
    }
    assignableDisks {
      id device type name vendor size firmwareRevision serialNum interfaceType
      smartStatus temperature isSpinning
      partitions { name fsType size }
    }
  }
`;

export const DISK_SECTOR_SIZES_QUERY = /* GraphQL */ `
  query McpDiskSectorSizes {
    disks { id bytesPerSector }
    assignableDisks { id bytesPerSector }
  }
`;

export const SHARES_QUERY = /* GraphQL */ `
  query McpShares {
    shares {
      id name free used size include exclude cache comment allocator splitLevel
      floor cow color luksStatus
    }
  }
`;

export const DOCKER_CONTAINERS_QUERY = /* GraphQL */ `
  query McpDockerContainers {
    docker {
      containers {
        id names image created
        ports { ip privatePort publicPort type }
        lanIpPorts sizeRootFs sizeRw sizeLog state status
        hostConfig { networkMode }
        autoStart autoStartOrder autoStartWait isOrphaned
      }
      portConflicts {
        containerPorts {
          privatePort type containers { id name }
        }
        lanPorts {
          lanIpPort publicPort type containers { id name }
        }
      }
    }
  }
`;

export const DOCKER_LOGS_QUERY = /* GraphQL */ `
  query McpDockerLogs($id: PrefixedID!, $since: DateTime, $tail: Int) {
    docker {
      logs(id: $id, since: $since, tail: $tail) {
        containerId cursor lines { timestamp message }
      }
    }
  }
`;

export const VMS_QUERY = /* GraphQL */ `
  query McpVms {
    vms { domains { id name state } }
  }
`;

export const UPS_DEVICES_QUERY = /* GraphQL */ `
  query McpUpsDevices {
    upsDevices {
      id name model status
      battery { chargeLevel estimatedRuntime health }
      power { inputVoltage outputVoltage loadPercentage nominalPower currentPower }
    }
  }
`;

export const UPS_DEVICES_COMPAT_QUERY = /* GraphQL */ `
  query McpUpsDevicesCompat {
    upsDevices {
      id name model status
      battery { chargeLevel estimatedRuntime health }
      power { inputVoltage outputVoltage loadPercentage }
    }
  }
`;

export const UPS_CONFIGURATION_QUERY = /* GraphQL */ `
  query McpUpsConfiguration {
    upsConfiguration {
      service upsCable customUpsCable upsType device overrideUpsCapacity
      batteryLevel minutes timeout killUps nisIp netServer upsName modelName
    }
  }
`;

export const NOTIFICATIONS_QUERY = /* GraphQL */ `
  query McpNotifications($filter: NotificationFilter!) {
    notifications {
      overview {
        unread { info warning alert total }
        archive { info warning alert total }
      }
      list(filter: $filter) {
        id title subject description importance link type timestamp formattedTimestamp
      }
      warningsAndAlerts {
        id title subject description importance link type timestamp formattedTimestamp
      }
    }
  }
`;

export const SYSTEM_LOGS_QUERY = /* GraphQL */ `
  query McpSystemLogs {
    logFiles { name path size modifiedAt }
  }
`;

export const SYSTEM_LOG_QUERY = /* GraphQL */ `
  query McpSystemLog($path: String!, $lines: Int, $startLine: Int) {
    logFile(path: $path, lines: $lines, startLine: $startLine) {
      path content totalLines startLine
    }
  }
`;

export const ARRAY_STATE_MUTATION = /* GraphQL */ `
  mutation McpSetArrayState($input: ArrayStateInput!) {
    array {
      setState(input: $input) {
        id state
        parityCheckStatus { ${PARITY_FIELDS} }
      }
    }
  }
`;

export const PARITY_MUTATIONS = {
  START: /* GraphQL */ `
    mutation McpStartParity($correct: Boolean!) {
      parityCheck { start(correct: $correct) }
    }
  `,
  PAUSE: /* GraphQL */ `mutation McpPauseParity { parityCheck { pause } }`,
  RESUME: /* GraphQL */ `mutation McpResumeParity { parityCheck { resume } }`,
  CANCEL: /* GraphQL */ `mutation McpCancelParity { parityCheck { cancel } }`,
} as const;

const DOCKER_RESULT_FIELDS = /* GraphQL */ `
  id names image state status autoStart autoStartOrder autoStartWait
`;

export const DOCKER_CONTROL_MUTATIONS = {
  START: /* GraphQL */ `
    mutation McpStartContainer($id: PrefixedID!) {
      docker { start(id: $id) { ${DOCKER_RESULT_FIELDS} } }
    }
  `,
  STOP: /* GraphQL */ `
    mutation McpStopContainer($id: PrefixedID!) {
      docker { stop(id: $id) { ${DOCKER_RESULT_FIELDS} } }
    }
  `,
  PAUSE: /* GraphQL */ `
    mutation McpPauseContainer($id: PrefixedID!) {
      docker { pause(id: $id) { ${DOCKER_RESULT_FIELDS} } }
    }
  `,
  UNPAUSE: /* GraphQL */ `
    mutation McpUnpauseContainer($id: PrefixedID!) {
      docker { unpause(id: $id) { ${DOCKER_RESULT_FIELDS} } }
    }
  `,
  UPDATE: /* GraphQL */ `
    mutation McpUpdateContainer($id: PrefixedID!) {
      docker { updateContainer(id: $id) { ${DOCKER_RESULT_FIELDS} } }
    }
  `,
} as const;

export const REMOVE_DOCKER_CONTAINER_MUTATION = /* GraphQL */ `
  mutation McpRemoveContainer($id: PrefixedID!, $withImage: Boolean) {
    docker { removeContainer(id: $id, withImage: $withImage) }
  }
`;

export const VM_CONTROL_MUTATIONS = {
  START: /* GraphQL */ `mutation McpStartVm($id: PrefixedID!) { vm { start(id: $id) } }`,
  STOP: /* GraphQL */ `mutation McpStopVm($id: PrefixedID!) { vm { stop(id: $id) } }`,
  PAUSE: /* GraphQL */ `mutation McpPauseVm($id: PrefixedID!) { vm { pause(id: $id) } }`,
  RESUME: /* GraphQL */ `mutation McpResumeVm($id: PrefixedID!) { vm { resume(id: $id) } }`,
  REBOOT: /* GraphQL */ `mutation McpRebootVm($id: PrefixedID!) { vm { reboot(id: $id) } }`,
} as const;

export const VM_DESTRUCTIVE_MUTATIONS = {
  FORCE_STOP: /* GraphQL */ `
    mutation McpForceStopVm($id: PrefixedID!) { vm { forceStop(id: $id) } }
  `,
  RESET: /* GraphQL */ `mutation McpResetVm($id: PrefixedID!) { vm { reset(id: $id) } }`,
} as const;

export const NOTIFICATION_MUTATIONS = {
  ARCHIVE: /* GraphQL */ `
    mutation McpArchiveNotifications($ids: [PrefixedID!]!) {
      archiveNotifications(ids: $ids) {
        unread { info warning alert total }
        archive { info warning alert total }
      }
    }
  `,
  UNARCHIVE: /* GraphQL */ `
    mutation McpUnarchiveNotifications($ids: [PrefixedID!]!) {
      unarchiveNotifications(ids: $ids) {
        unread { info warning alert total }
        archive { info warning alert total }
      }
    }
  `,
} as const;
