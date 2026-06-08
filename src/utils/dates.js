function differenceInDays(dateLeft, dateRight) {
  const msPerDay = 1000 * 60 * 60 * 24;
  const utcLeft  = Date.UTC(dateLeft.getFullYear(),  dateLeft.getMonth(),  dateLeft.getDate());
  const utcRight = Date.UTC(dateRight.getFullYear(), dateRight.getMonth(), dateRight.getDate());
  return Math.floor((utcLeft - utcRight) / msPerDay);
}

module.exports = { differenceInDays };
