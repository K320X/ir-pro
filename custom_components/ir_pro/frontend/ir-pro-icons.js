'use strict';
const irConceptSwingOutlet='<path d="M3 3h14v4h4v14"/>';
const irConceptSwingRays=[
  'M11 7H3',
  'M11.294 8.854 3.685 11.326',
  'M12.146 10.527 5.674 15.229',
  'M13.473 11.854 8.771 18.326',
  'M15.146 12.706 12.674 20.315',
  'M17 13V21'
];
function irConceptSwingIcon(position){return irConceptSwingOutlet+irConceptSwingRays.map((path,index)=>'<path d="'+path+'"'+(position!==undefined&&position!==index?' opacity=".18"':'')+'/>').join('');}
function irConceptFanSpeedIcon(total,level){
  const gap=1.5,width=Math.min(4,(20-gap*(total-1))/total),start=(24-(width*total+gap*(total-1)))/2;
  return Array.from({length:total},(_,index)=>{
    const height=6+12*index/(total-1),x=start+index*(width+gap);
    return '<rect x="'+Number(x.toFixed(3))+'" y="'+Number((21-height).toFixed(3))+'" width="'+Number(width.toFixed(3))+'" height="'+Number(height.toFixed(3))+'" rx=".55" fill="currentColor" stroke="none" opacity="'+(index<level?'1':'.18')+'"/>';
  }).join('');
}
const irConceptIconPaths={
'tv-input':'<rect x="3" y="4" width="18" height="15" rx="2"/><path d="M3 12h11m-4-4 4 4-4 4M8 22h8"/>',
'volume-off':'<path d="M4 9h4l5-4v14l-5-4H4Z M17 9l5 6m0-6-5 6"/>',
power:'<path d="M12 2v10M6 5.5a9 9 0 1 0 12 0"/>',
'power-off':'<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',
snowflake:'<path d="M12 2v20M3.4 7l17.2 10M3.4 17l17.2-10M8 4l4 3 4-3M8 20l4-3 4 3M3 11l4-1-1-4M21 13l-4 1 1 4M6 18l1-4-4-1M18 6l-1 4 4 1"/>',
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
droplet:'<path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/><path d="M15.5 15a3.5 3.5 0 0 1-3 3.5"/>',
fan:'<circle cx="12" cy="12" r="2"/><path d="M10 10C4 9 4 3 8 3c3 0 6 3 5 7M14 10c4-4 9-2 8 2-1 3-5 4-8 2M12 14c2 6-2 10-5 7-2-2-1-6 3-8"/>',
wind:'<path d="M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M4 16h5a3 3 0 1 1-3 3"/>',
'chevron-up':'<path d="m5 15 7-7 7 7"/>','chevron-down':'<path d="m5 9 7 7 7-7"/>','chevron-right':'<path d="m9 5 7 7-7 7"/>','arrow-left':'<path d="M20 12H4m7-7-7 7 7 7"/>',
settings:'<path d="M9.988 4.983 10.187 2.675 13.813 2.675 14.012 4.983A7.3 7.3 0 0 1 17.071 6.749L19.17 5.767 20.982 8.907 19.083 10.234A7.3 7.3 0 0 1 19.083 13.766L20.982 15.093 19.17 18.233 17.071 17.251A7.3 7.3 0 0 1 14.012 19.017L13.813 21.325 10.187 21.325 9.988 19.017A7.3 7.3 0 0 1 6.929 17.251L4.83 18.233 3.018 15.093 4.917 13.766A7.3 7.3 0 0 1 4.917 10.234L3.018 8.907 4.83 5.767 6.929 6.749A7.3 7.3 0 0 1 9.988 4.983Z"/><circle cx="12" cy="12" r="3.2"/>',
pencil:'<path d="m16 3 5 5M4 15 16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L9 20l-6 1 1-6Z"/>',
copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
more:'<circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
display:'<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 22h8M12 18v4M6 9h5M6 13h10"/>',
remote:'<rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="7" r="1.5"/><path d="M10 12h.01M14 12h.01M10 16h.01M14 16h.01"/>',
tv:'<rect x="2" y="6" width="20" height="14" rx="2"/><path d="m8 2 4 4 4-4"/>',
radio:'<path d="M9 9a4 4 0 0 0 0 6M6 6a8 8 0 0 0 0 12M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12M12 12v10"/><circle cx="12" cy="12" r="1"/>',
'add-row':'<rect x="3" y="3" width="18" height="7" rx="2"/><path d="M3 14h18M3 19h10M19 16v6M16 19h6"/>',
check:'<path d="m5 12 4 4L20 5"/>',x:'<path d="m6 6 12 12M6 18 18 6"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
thermometer:'<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z"/><path d="M12 8v9"/><circle cx="12" cy="18" r="1"/>',
move:'<path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
moon:'<path d="M20.8 13a9 9 0 0 1-9.8-9.8A9 9 0 1 0 20.8 13Z"/>',
light:'<path d="M9 18h6M10 22h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4Z"/>',
home:'<path d="m3 10 9-8 9 8v11h-7v-8h-4v8H3Z"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
automation:'<path d="M4 5h7M4 12h4M4 19h7m5-16-5 9h6l-2 9 7-12h-6Z"/>',
history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v6l4 2"/>',
bell:'<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 22h4"/>',
phone:'<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/>',
desktop:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v5M7 22h10"/>',
auto:'<path d="m5 20 7-16 7 16M8 14h8"/>',
'volume-2':'<path d="M4 9h4l5-4v14l-5-4H4Z M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14"/>',
'move-vertical':'<path d="M12 3v18 M7 8l5-5 5 5 M7 16l5 5 5-5"/>',
'move-horizontal':'<path d="M3 12h18 M8 7l-5 5 5 5 M16 7l5 5-5 5"/>',
timer:'<circle cx="12" cy="13" r="8"/><path d="M9 2h6 M12 8v5h4 M18 5l2-2"/>',
'timer-off':'<circle cx="12" cy="13" r="8"/><path d="M9 2h6 M12 8v5h4 M3 3l18 18"/>',
zap:'<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>',
leaf:'<path d="M20 3C3 2 2 10 5 16c4 7 16 3 15-13Z M4 21l11-12"/>',
swing:irConceptSwingIcon(),
'swing-position-1':irConceptSwingIcon(5),
'swing-position-2':irConceptSwingIcon(4),
'swing-position-3':irConceptSwingIcon(3),
'swing-position-4':irConceptSwingIcon(2),
'swing-position-5':irConceptSwingIcon(1),
'swing-position-6':irConceptSwingIcon(0),
'swing-off':irConceptSwingOutlet,
'air-vent':'<rect x="2" y="4" width="20" height="9" rx="2"/><path d="M5 10h14M7 16l-1 4M12 16v5M17 16l1 4"/>'
};
export function icon(name){
  const aliases={droplets:'droplet',lightbulb:'light'};name=aliases[name]||name;
  const speed=/^fan-speed-([2-5])-([1-5])$/.exec(String(name));
  const paths=speed&&Number(speed[2])<=Number(speed[1])?irConceptFanSpeedIcon(Number(speed[1]),Number(speed[2])):(irConceptIconPaths[name]||irConceptIconPaths.remote);
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+paths+'</svg>';
}
