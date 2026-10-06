/*** PAGINATION FIXES FOR Code.js ***/

/**
 * FIXED: Get users from Connecteam API with proper pagination
 * Excludes Admin staff for rostering purposes
 */
function getUsers() {
  Logger.log('getUsers: Fetching users from Connecteam API (excluding Admin)');

  // Check cache first
  if (_usersCache && _usersCacheTime) {
    var cacheAge = new Date().getTime() - _usersCacheTime;
    if (cacheAge < USERS_CACHE_DURATION) {
      Logger.log('getUsers: Using cached users data (age: ' + Math.round(cacheAge/1000) + ' seconds)');
      return _usersCache;
    } else {
      Logger.log('getUsers: Cache expired, fetching fresh data');
    }
  }

  try {
    // FIXED: Use pagination to get ALL users
    var allUsers = [];
    var offset = 0;
    var limit = 200; // Connecteam's max limit
    var pageCount = 0;

    do {
      var queryParams = 'limit=' + limit + '&offset=' + offset + '&order=asc&userStatus=active';
      var url = 'users/v1/users?' + queryParams;
      var response = connecteamApiRequest_(url, 'get', null);
      
      if (!response || !Array.isArray(response.users)) {
        Logger.log('getUsers ERROR: Unexpected API response format');
        Logger.log('getUsers ERROR: response keys = ' + (response ? Object.keys(response).join(', ') : 'null'));
        throw new Error('Unexpected API response format from Connecteam Users API');
      }

      var usersArray = response.users;
      Logger.log('getUsers page ' + (pageCount + 1) + ': Retrieved ' + usersArray.length + ' users');
      
      allUsers = allUsers.concat(usersArray);
      offset += limit;
      pageCount++;

      // Safety check: prevent infinite loops
      if (pageCount >= 50) { // 50 * 200 = 10,000 users max
        Logger.log('getUsers: Reached safety limit of 50 pages (10,000 users)');
        break;
      }
    } while (usersArray.length === limit);

    Logger.log('getUsers: Retrieved ' + allUsers.length + ' total users across ' + pageCount + ' page(s)');

    var users = {};
    var skippedCount = 0;
    var includedCount = 0;

    allUsers.forEach(function(user) {
      // Extract name (firstName + lastName)
      var firstName = user.firstName || '';
      var lastName = user.lastName || '';
      var fullName = (firstName + ' ' + lastName).trim();

      // Extract ID (userId)
      var userId = user.userId;

      if (!fullName || !userId) {
        Logger.log('getUsers: Skipping user - missing name or ID (userId: ' + userId + ')');
        skippedCount++;
        return;
      }

      // Extract team from custom fields
      var team = 'Other';
      if (user.customFields && Array.isArray(user.customFields)) {
        var teamField = user.customFields.find(function(field) {
          return field.name === 'Team';
        });
        if (teamField && teamField.value && Array.isArray(teamField.value) && teamField.value.length > 0) {
          team = teamField.value[0].value || 'Other';
        }
      }

      // Skip separator entries and admin staff
      if (fullName.indexOf('--') !== -1) {
        Logger.log('getUsers: Skipping separator: ' + fullName);
        skippedCount++;
        return;
      }

      if (team === 'Admin') {
        Logger.log('getUsers: Skipping admin user: ' + fullName + ' (userId: ' + userId + ')');
        skippedCount++;
        return;
      }

      // Map team to role for compatibility
      var role = team;

      Logger.log('getUsers: Including user: ' + fullName + ' (userId: ' + userId + ', team: ' + team + ')');
      includedCount++;

      users[userId.toString()] = {
        name: fullName,
        id: userId.toString(),
        role: role
      };
    });

    Logger.log('getUsers: Summary - Total from API: ' + allUsers.length + ', Included: ' + includedCount + ', Skipped: ' + skippedCount);
    Logger.log('getUsers: Processed ' + Object.keys(users).length + ' active users (excluding admin and separators)');

    // Cache the results
    _usersCache = users;
    _usersCacheTime = new Date().getTime();

    return users;

  } catch (error) {
    Logger.log('getUsers ERROR: Failed to fetch from Connecteam API - ' + error.message);
    Logger.log('getUsers: Attempting Google Sheets fallback...');

    // Fallback to Google Sheets if API fails
    try {
      var sheet = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheets()[0];
      var values = sheet.getDataRange().getValues();
      if (!values.length) return {};
      var header = values[0].map(function(h){return (h || '').toString().trim().toLowerCase();});
      var nameIdx = header.indexOf('name');
      var idIdx = header.indexOf('id');
      if (idIdx < 0) idIdx = header.indexOf('user id');
      var roleIdx = header.indexOf('role');
      if (roleIdx < 0) roleIdx = header.indexOf('team');
      var users = {};
      for (var i = 1; i < values.length; ++i) {
        var name = nameIdx >= 0 ? values[i][nameIdx] : values[i][0];
        var id = idIdx >= 0 ? values[i][idIdx] : values[i][1];
        var role = roleIdx >= 0 ? (values[i][roleIdx] || '').toString().trim() : '';
        var nameStr = (name || '').toString().trim();
        var idStr = (id != null ? id.toString().trim() : '');
        if (!nameStr || nameStr.indexOf('--') !== -1) continue;
        if (!idStr || idStr === '0' || idStr.toLowerCase() === 'id') continue;
        users[idStr] = { name: nameStr, id: idStr, role: role };
      }
      Logger.log('getUsers: Fallback successful - retrieved ' + Object.keys(users).length + ' users from Google Sheets');
      return users;
    } catch (sheetError) {
      Logger.log('getUsers ERROR: Fallback to Google Sheets also failed - ' + sheetError.message);
      return {};
    }
  }
}

/**
 * FIXED: Get ALL users from Connecteam API including Admin staff with pagination
 */
function getAllUsers() {
  Logger.log('getAllUsers: Fetching ALL users from Connecteam API (including Admin)');

  // Check cache first
  if (_usersAllCache && _usersCacheTime) {
    var cacheAge = new Date().getTime() - _usersCacheTime;
    if (cacheAge < USERS_CACHE_DURATION) {
      Logger.log('getAllUsers: Using cached ALL users data (age: ' + Math.round(cacheAge/1000) + ' seconds)');
      return _usersAllCache;
    } else {
      Logger.log('getAllUsers: Cache expired, fetching fresh data');
    }
  }

  try {
    // FIXED: Use pagination to get ALL users
    var allUsers = [];
    var offset = 0;
    var limit = 200; // Connecteam's max limit
    var pageCount = 0;

    do {
      var queryParams = 'limit=' + limit + '&offset=' + offset + '&order=asc&userStatus=active';
      var url = 'users/v1/users?' + queryParams;
      var response = connecteamApiRequest_(url, 'get', null);
      
      if (!response || !Array.isArray(response.users)) {
        Logger.log('getAllUsers ERROR: Unexpected API response format');
        Logger.log('getAllUsers ERROR: response keys = ' + (response ? Object.keys(response).join(', ') : 'null'));
        throw new Error('Unexpected API response format from Connecteam Users API');
      }

      var usersArray = response.users;
      Logger.log('getAllUsers page ' + (pageCount + 1) + ': Retrieved ' + usersArray.length + ' users');
      
      allUsers = allUsers.concat(usersArray);
      offset += limit;
      pageCount++;

      // Safety check: prevent infinite loops
      if (pageCount >= 50) { // 50 * 200 = 10,000 users max
        Logger.log('getAllUsers: Reached safety limit of 50 pages (10,000 users)');
        break;
      }
    } while (usersArray.length === limit);

    Logger.log('getAllUsers: Retrieved ' + allUsers.length + ' total users across ' + pageCount + ' page(s)');

    var users = {};
    var skippedCount = 0;
    var includedCount = 0;

    allUsers.forEach(function(user) {
      // Extract name (firstName + lastName)
      var firstName = user.firstName || '';
      var lastName = user.lastName || '';
      var fullName = (firstName + ' ' + lastName).trim();

      // Extract ID (userId)
      var userId = user.userId;

      if (!fullName || !userId) {
        Logger.log('getAllUsers: Skipping user - missing name or ID (userId: ' + userId + ')');
        skippedCount++;
        return;
      }

      // Extract team from custom fields
      var team = 'Other';
      if (user.customFields && Array.isArray(user.customFields)) {
        var teamField = user.customFields.find(function(field) {
          return field.name === 'Team';
        });
        if (teamField && teamField.value && Array.isArray(teamField.value) && teamField.value.length > 0) {
          team = teamField.value[0].value || 'Other';
        }
      }

      // ONLY skip separator entries - INCLUDE Admin users for reporting
      if (fullName.indexOf('--') !== -1) {
        Logger.log('getAllUsers: Skipping separator: ' + fullName);
        skippedCount++;
        return;
      }

      // Map team to role for compatibility
      var role = team;

      Logger.log('getAllUsers: Including user: ' + fullName + ' (userId: ' + userId + ', team: ' + team + ')');
      includedCount++;

      users[userId.toString()] = {
        name: fullName,
        id: userId.toString(),
        role: role
      };
    });

    Logger.log('getAllUsers: Summary - Total from API: ' + allUsers.length + ', Included: ' + includedCount + ' (including Admin), Skipped: ' + skippedCount);

    // Cache the results
    _usersAllCache = users;
    _usersCacheTime = new Date().getTime();

    return users;

  } catch (error) {
    Logger.log('getAllUsers ERROR: Failed to fetch from Connecteam API - ' + error.message);
    Logger.log('getAllUsers: Attempting Google Sheets fallback...');

    // Fallback to Google Sheets if API fails
    try {
      var sheet = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheets()[0];
      var values = sheet.getDataRange().getValues();
      if (!values.length) return {};
      var header = values[0].map(function(h){return (h || '').toString().trim().toLowerCase();});
      var nameIdx = header.indexOf('name');
      var idIdx = header.indexOf('id');
      if (idIdx < 0) idIdx = header.indexOf('user id');
      var roleIdx = header.indexOf('role');
      if (roleIdx < 0) roleIdx = header.indexOf('team');
      var users = {};
      for (var i = 1; i < values.length; ++i) {
        var name = nameIdx >= 0 ? values[i][nameIdx] : values[i][0];
        var id = idIdx >= 0 ? values[i][idIdx] : values[i][1];
        var role = roleIdx >= 0 ? (values[i][roleIdx] || '').toString().trim() : '';
        var nameStr = (name || '').toString().trim();
        var idStr = (id != null ? id.toString().trim() : '');
        if (!nameStr || nameStr.indexOf('--') !== -1) continue;
        if (!idStr || idStr === '0' || idStr.toLowerCase() === 'id') continue;
        users[idStr] = { name: nameStr, id: idStr, role: role };
      }
      Logger.log('getAllUsers: Fallback successful - retrieved ' + Object.keys(users).length + ' users from Google Sheets');
      return users;
    } catch (sheetError) {
      Logger.log('getAllUsers ERROR: Fallback to Google Sheets also failed - ' + sheetError.message);
      return {};
    }
  }
}

/**
 * FIXED: Get all jobs for scheduler with pagination
 */
function getJobs() {
  try {
    var allJobs = [];
    var offset = 0;
    var limit = 200; // Connecteam's max limit
    var pageCount = 0;

    do {
      var endpoint = `jobs/v1/jobs?instanceIds=${SCHEDULER_ID}&limit=${limit}&offset=${offset}&order=asc`;
      var data = connecteamApiRequest_(endpoint, 'get');
      var jobsArray = data.jobs || [];
      
      Logger.log('getJobs page ' + (pageCount + 1) + ': Retrieved ' + jobsArray.length + ' jobs');
      
      allJobs = allJobs.concat(jobsArray);
      offset += limit;
      pageCount++;

      // Safety check: prevent infinite loops
      if (pageCount >= 25) { // 25 * 200 = 5,000 jobs max
        Logger.log('getJobs: Reached safety limit of 25 pages (5,000 jobs)');
        break;
      }
    } while (allJobs.length === limit);

    var jobs = {};
    allJobs.forEach(function(job) {
      jobs[job.jobId || job.id] = job;
      jobCache[job.jobId || job.id] = job; // Cache them
    });
    
    Logger.log('getJobs FIXED: Loaded ' + Object.keys(jobs).length + ' jobs from scheduler across ' + pageCount + ' page(s)');
    return jobs;
  } catch (e) {
    Logger.log('Error loading jobs: ' + e.message);
    return {};
  }
}

/**
 * FIXED: Get scheduled summary with pagination
 */
function getScheduledSummary(dateFrom, dateTo) {
  // Convert dates to Unix seconds for API
  var startUnix = Math.floor(new Date(dateFrom).getTime() / 1000);
  var endUnix = Math.floor(new Date(dateTo).getTime() / 1000);
  
  // FIXED: Use pagination to get ALL shifts
  var allShifts = [];
  var offset = 0;
  var limit = 100;
  var pageCount = 0;

  do {
    var endpoint = `scheduler/v1/schedulers/${SCHEDULER_ID}/shifts?startTime=${startUnix}&endTime=${endUnix}&limit=${limit}&offset=${offset}&order=asc`;
    Logger.log('getScheduledSummary: Fetching page ' + (pageCount + 1) + ' with offset ' + offset);
    
    var shiftsData = connecteamApiRequest_(endpoint, 'get');
    var pageShifts = shiftsData.shifts || [];
    
    Logger.log('getScheduledSummary page ' + (pageCount + 1) + ': Retrieved ' + pageShifts.length + ' shifts');
    
    allShifts = allShifts.concat(pageShifts);
    offset += limit;
    pageCount++;

    // Safety check: prevent infinite loops
    if (pageCount >= 100) { // 100 * 100 = 10,000 shifts max
      Logger.log('getScheduledSummary: Reached safety limit of 100 pages (10,000 shifts)');
      break;
    }
  } while (allShifts.length === limit);

  Logger.log('getScheduledSummary FIXED: Retrieved ' + allShifts.length + ' total shifts across ' + pageCount + ' page(s)');

  var users = getUsers();
  
  // Extract unique job IDs for lookup
  var uniqueJobIds = [...new Set(allShifts.filter(s => s.jobId).map(s => s.jobId))];
  if (uniqueJobIds.length > 0) {
    loadJobsForIds(uniqueJobIds);
  }
  
  var summary = {};
  allShifts.forEach(function(shift) {
    var assignedUsers = shift.assignedUserIds || [];
    var hasAcceptedStatus = Array.isArray(shift.statuses) && shift.statuses.some(function(status){ return status.status === 'accepted'; });
    
    // Skip if no assigned users
    if (assignedUsers.length === 0) return;
    
    // Skip open shifts ONLY if they have not been accepted
    if (shift.isOpenShift && !hasAcceptedStatus) return;
    
    var userId = assignedUsers[0]; // Take first assigned user
    if (!summary[userId]) summary[userId] = {};
    
    var startDate = new Date(shift.startTime * 1000);
    if (shift.startTime && isNaN(startDate.getTime())) {
      Logger.log('Invalid startTime for shift ' + shift.id + ': ' + shift.startTime);
      return;
    }
    
    var month = startDate.toISOString().slice(0, 7);
    if (!summary[userId][month]) summary[userId][month] = { count: 0, details: [] };
    summary[userId][month].count++;
    
    // Get job name with lookup
    var jobName = 'Unknown';
    if (shift.job && shift.job.title) {
      jobName = shift.job.title;
    } else if (shift.jobId) {
      var job = jobCache[shift.jobId];
      jobName = job ? job.title : 'Unknown Job (' + shift.jobId + ')';
    }
    
    summary[userId][month].details.push({
      date: toAustralianDate(startDate),
      job: jobName,
      start: toAustralianDate(startDate),
      end: toAustralianDate(new Date(shift.endTime * 1000))
    });
  });
  
  // Format result for frontend
  var results = [];
  Object.keys(summary).forEach(function(userId) {
    var user = users[userId];
    Object.keys(summary[userId]).forEach(function(month) {
      results.push({
        user: user ? user.name : userId,
        month: month,
        count: summary[userId][month].count,
        details: summary[userId][month].details
      });
    });
  });
  
  Logger.log('getScheduledSummary FIXED: Processed ' + allShifts.length + ' shifts into summary');
  return results;
}

/**
 * FIXED: Get worked summary with pagination within time chunks
 */
function getWorkedSummary(dateFrom, dateTo) {
  var fromDate = new Date(dateFrom);
  var toDate = new Date(dateTo);
  var users = getUsers();
  var summary = {};

  // Chunk into 30-day periods for time-clock API (conservative for potential 45-day limit)
  var chunkSize = 30;
  var current = new Date(fromDate);
  while (current <= toDate) {
    var chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + chunkSize);
    if (chunkEnd > toDate) chunkEnd = toDate;

    var fromYmd = current.toISOString().slice(0, 10);
    var toYmd = chunkEnd.toISOString().slice(0, 10);
    
    // FIXED: Use pagination within each time chunk
    var allActivities = [];
    var offset = 0;
    var limit = 100;
    var pageCount = 0;

    do {
      var endpoint = `time-clock/v1/time-clocks/${CLOCK_ID}/time-activities?startDate=${fromYmd}&endDate=${toYmd}&limit=${limit}&offset=${offset}&order=asc`;
      var entriesData = connecteamApiRequest_(endpoint, 'get');
      
      // Handle different response structures
      var pageActivities = [];
      if (entriesData.timeActivitiesByUsers) {
        pageActivities = entriesData.timeActivitiesByUsers.flatMap(function(userData) {
          return (userData.shifts || []).map(function(shift) {
            return { ...shift, userId: userData.userId };
          });
        });
      } else if (entriesData.data && entriesData.data.timeActivitiesByUsers) {
        pageActivities = entriesData.data.timeActivitiesByUsers.flatMap(function(userData) {
          return (userData.shifts || []).map(function(shift) {
            return { ...shift, userId: userData.userId };
          });
        });
      }

      Logger.log('Time clock chunk (' + fromYmd + ' to ' + toYmd + ') page ' + (pageCount + 1) + ': ' + pageActivities.length + ' activities');
      
      allActivities = allActivities.concat(pageActivities);
      offset += limit;
      pageCount++;

      // Safety check: prevent infinite loops
      if (pageCount >= 50) { // 50 * 100 = 5,000 activities per chunk max
        Logger.log('Time activities: Reached safety limit of 50 pages per chunk');
        break;
      }
    } while (allActivities.length === limit);

    Logger.log('Time clock chunk (' + fromYmd + ' to ' + toYmd + '): ' + Object.keys(entriesData).length + ' keys, ' + allActivities.length + ' total activities across ' + pageCount + ' page(s)');

    allActivities.forEach(function(entry) {
      var userId = entry.userId;
      if (!userId) return; // Skip if no userId
      if (!summary[userId]) summary[userId] = {};
      var startDate = new Date(entry.startTime * 1000); // Convert Unix seconds to ms
      var month = startDate.toISOString().slice(0, 7);
      if (!summary[userId][month]) summary[userId][month] = { hours: 0, details: [] };
      var endDate = new Date(entry.endTime * 1000);
      var hours = ((endDate - startDate) / 3600000) || 0;
      summary[userId][month].hours += hours;
      summary[userId][month].details.push({
        date: toAustralianDate(startDate),
        start: toAustralianDate(startDate),
        end: toAustralianDate(endDate),
        hours: hours.toFixed(2)
      });
    });

    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1); // Advance to next day
  }

  // Format result for frontend
  var results = [];
  Object.keys(summary).forEach(function(userId) {
    var user = users[userId];
    Object.keys(summary[userId]).forEach(function(month) {
      results.push({
        user: user ? user.name : userId,
        month: month,
        hours: summary[userId][month].hours.toFixed(2),
        details: summary[userId][month].details
      });
    });
  });
  
  Logger.log('getWorkedSummary FIXED: Processed with pagination across all time chunks');
  return results;
}

/**
 * FIXED: Timesheet API calls with pagination
 */
function buildLastShiftEndMapFromTimesheets(endDate, daysBack) {
  var lastEnd = {};
  var startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - daysBack);
  
  Logger.log('buildLastShiftEndMapFromTimesheets: FIXED lookup with pagination - ' + daysBack + ' days from ' + endDate.toDateString() + ' to ' + startDate.toDateString());
  
  // CRITICAL FIX: Use 45-day chunks (API limit) instead of 60-day
  var chunkSize = 45; // API limit is 45 days for timesheet endpoint
  var current = new Date(startDate);
  var totalEntries = 0;
  var apiCalls = 0;
  
  while (current < endDate) {
    var chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + chunkSize);
    if (chunkEnd > endDate) chunkEnd = endDate;
    
    var fromYmd = current.toISOString().slice(0, 10);
    var toYmd = chunkEnd.toISOString().slice(0, 10);
    
    try {
      // FIXED: Use pagination within each date chunk
      var allUsers = [];
      var offset = 0;
      var limit = 100;
      var pageCount = 0;

      do {
        var endpoint = 'time-clock/v1/time-clocks/' + CLOCK_ID + '/timesheet?startDate=' + fromYmd + '&endDate=' + toYmd + '&limit=' + limit + '&offset=' + offset + '&order=asc';
        var timesheetData = connecteamApiRequest_(endpoint, 'get');
        apiCalls++;
        
        var usersArray = timesheetData.users || [];
        Logger.log('Timesheet chunk (' + fromYmd + ' to ' + toYmd + ') page ' + (pageCount + 1) + ': ' + usersArray.length + ' users');
        
        allUsers = allUsers.concat(usersArray);
        offset += limit;
        pageCount++;

        // Safety check: prevent infinite loops
        if (pageCount >= 20) { // 20 * 100 = 2,000 users per chunk max
          Logger.log('Timesheet: Reached safety limit of 20 pages per chunk');
          break;
        }
      } while (allUsers.length === limit);

      // Process timesheet data efficiently
      allUsers.forEach(function(userData) {
        var userId = userData.userId;
        if (!userId) return;
        
        var dailyRecords = userData.dailyRecords || [];
        dailyRecords.forEach(function(dailyRecord) {
          var records = dailyRecord.records || [];
          records.forEach(function(record) {
            if (!record.end || !record.end.timestamp) return;
            
            var endTimestamp = record.end.timestamp * 1000; // Convert to milliseconds
            var prev = lastEnd[userId];
            if (!prev || endTimestamp > prev) {
              lastEnd[userId] = endTimestamp;
              totalEntries++;
            }
          });
        });
      });
      
    } catch (e) {
      Logger.log('buildLastShiftEndMapFromTimesheets: Error fetching timesheet for ' + fromYmd + ' to ' + toYmd + ': ' + e.message);
    }
    
    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1);
  }
  
  Logger.log('buildLastShiftEndMapFromTimesheets: FIXED with pagination - Generated last shift map for ' + Object.keys(lastEnd).length + ' users from ' + totalEntries + ' entries using ' + apiCalls + ' API calls (respecting 45-day API limit)');
  return lastEnd;
}

/**
 * FIXED: Rolling worked counts with pagination
 */
function getRollingWorkedCountsRange(startDate, endDate) {
  Logger.log('getRollingWorkedCountsRange: FIXED version using timesheet API with 45-day limit and pagination');
  
  // CRITICAL FIX: Use 45-day chunks (API limit) instead of 60-day
  var chunkSize = 45; // API limit is 45 days for timesheet endpoint
  var current = new Date(startDate);
  var counts = {};
  var totalEntries = 0;
  var apiCalls = 0;

  while (current <= endDate) {
    var chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + chunkSize);
    if (chunkEnd > endDate) chunkEnd = endDate;

    var fromYmd = current.toISOString().slice(0, 10);
    var toYmd = chunkEnd.toISOString().slice(0, 10);
    
    try {
      // FIXED: Use pagination within each date chunk
      var allUsers = [];
      var offset = 0;
      var limit = 100;
      var pageCount = 0;

      do {
        // Use timesheet API for more complete and structured data
        var endpoint = 'time-clock/v1/time-clocks/' + CLOCK_ID + '/timesheet?startDate=' + fromYmd + '&endDate=' + toYmd + '&limit=' + limit + '&offset=' + offset + '&order=asc';
        var timesheetData = connecteamApiRequest_(endpoint, 'get');
        apiCalls++;
        
        var usersArray = timesheetData.users || [];
        Logger.log('Rolling counts chunk (' + fromYmd + ' to ' + toYmd + ') page ' + (pageCount + 1) + ': ' + usersArray.length + ' users');
        
        allUsers = allUsers.concat(usersArray);
        offset += limit;
        pageCount++;

        // Safety check: prevent infinite loops
        if (pageCount >= 20) { // 20 * 100 = 2,000 users per chunk max
          Logger.log('Rolling counts: Reached safety limit of 20 pages per chunk');
          break;
        }
      } while (allUsers.length === limit);
      
      // Process timesheet data efficiently
      allUsers.forEach(function(userData) {
        var userId = userData.userId;
        if (!userId) return;
        
        var dailyRecords = userData.dailyRecords || [];
        dailyRecords.forEach(function(dailyRecord) {
          var records = dailyRecord.records || [];
          records.forEach(function(record) {
            if (!record.start || !record.start.timestamp) return;
            
            var startMs = record.start.timestamp * 1000;
            var endMs = record.end ? record.end.timestamp * 1000 : startMs;
            var hrs = ((endMs - startMs) / 3600000) || 0;
            if (hrs < 0) hrs = 0;
            
            // Use direct resource mapping instead of job API lookups
            var jobType = 'Other';
            if (record.resources && record.resources.length > 0) {
              var resource = record.resources[0]; // Take first resource
              jobType = getJobTypeFromResourceId(resource.resourceId, resource.subResourceId);
            }
            
            if (!counts[userId]) {
              counts[userId] = { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
            }
            
            counts[userId].total += 1;
            counts[userId].byType[jobType] = (counts[userId].byType[jobType] || 0) + 1;
            counts[userId].hoursTotal += hrs;
            counts[userId].hoursByType[jobType] = (counts[userId].hoursByType[jobType] || 0) + hrs;
            totalEntries++;
          });
        });
      });
      
    } catch (e) {
      Logger.log('getRollingWorkedCountsRange: timesheet API error for ' + fromYmd + ' to ' + toYmd + ': ' + e.message);
    }

    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1);
  }

  var expectedApiCalls = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24 * 30)); // 30-day chunks
  Logger.log('getRollingWorkedCountsRange: FIXED with pagination - Processed ' + totalEntries + ' entries into ' + Object.keys(counts).length + ' users using ' + apiCalls + ' API calls (respecting 45-day API limit)');
  return counts;
}