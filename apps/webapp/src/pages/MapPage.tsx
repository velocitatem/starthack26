import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import DatacenterMap from '@/components/DatacenterMap';
import DeviceDetailPanel from '@/components/DeviceDetailPanel';
import { type FacilityContext } from '@/types/facility';

export default function MapPage() {
  const { ahuUnits, devices, nodePositions } = useOutletContext<FacilityContext>();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const selectedDevice = devices.find(d => d.id === selectedDeviceId) ?? null;

  return (
    <>
      <DatacenterMap
        ahuUnits={ahuUnits}
        devices={devices}
        nodePositions={nodePositions}
        onDeviceSelect={(device) => setSelectedDeviceId(device.id)}
        selectedDeviceId={selectedDeviceId}
      />
      <DeviceDetailPanel device={selectedDevice} onClose={() => setSelectedDeviceId(null)} />
    </>
  );
}
