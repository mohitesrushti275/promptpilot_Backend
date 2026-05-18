export function determineSections(userSections, aiDetectedSections) {
  let result = [];

  // If the user explicitly provided sections in the Design Manifest GUI,
  // we enforce them as the structural backbone.
  if (userSections && Array.isArray(userSections) && userSections.length > 0) {
    console.log('[Section Detection] Using user-provided sections:', userSections);
    result = [...userSections];
  }
  // Otherwise, fallback to the sections detected natively from the website screenshot
  else if (aiDetectedSections && Array.isArray(aiDetectedSections) && aiDetectedSections.length > 0) {
    console.log('[Section Detection] Using AI-detected sections:', aiDetectedSections);
    result = [...aiDetectedSections];
  }
  else {
    // Failsafe default
    result = ["Hero", "Features", "CTA", "Footer"];
  }

  // Enforce presence of BOTH "Header" and "Footer"
  const headerIndex = result.findIndex(s => s && s.toLowerCase() === 'header');
  let headerValue = 'Header';
  if (headerIndex !== -1) {
    headerValue = result[headerIndex];
    result.splice(headerIndex, 1);
  }

  const footerIndex = result.findIndex(s => s && s.toLowerCase() === 'footer');
  let footerValue = 'Footer';
  if (footerIndex !== -1) {
    footerValue = result[footerIndex];
    result.splice(footerIndex, 1);
  }

  // Put Header at the absolute top and Footer at the absolute bottom
  result.unshift(headerValue);
  result.push(footerValue);

  return result;
}
