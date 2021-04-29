import getTimezoneManager from './timezoneDataProviderService'
import jstz from 'jstz'
import DateTimeValue from 'calendar-js/src/values/dateTimeValue'
import { createEvent, getParserManager } from 'calendar-js'
import { findAllCalendars } from './caldavService'
import { calcShiftDate } from '../utils/date'
import AttendeeProperty from 'calendar-js/src/properties/attendeeProperty'

const organizerName = 'admin'
const organizerEmail = 'technik@csoc.de'

/**
 * returns the calDav conform Timezone
 *
 * @returns {Timezone}
 */
const findCurrentTimezone = () => {
	const timezoneManager = getTimezoneManager()
	const determinedTimezone = jstz.determine()
	return timezoneManager.getTimezoneForId(determinedTimezone.name())
}

const timezone = findCurrentTimezone()

const syncAllAssignedShifts = async(shiftsList, shiftTypes, allAnalysts) => {
	const shiftsCalendar = await findShiftsCalendar()
	const groups = shiftsList.reduce((array, item) => {
		const group = (array[item.date] || [])
		group.push(item)
		array[item.date] = group
		return array
	}, {})
	for (const group in groups) {
		for (const shiftType of shiftTypes) {
			const analysts = []
			const shifts = groups[group].filter(item => item.shiftTypeId === shiftType.id.toString())
			shifts.forEach(shift => {
				analysts.push(allAnalysts.find((analyst) => {
					analyst.uid = analyst.uid.replaceAll('.', '-')
					return shift.userId === analyst.uid
				}))
			})

			await syncCalendarObject(shiftsCalendar, shiftType, group, analysts)
		}
	}
}

const saveCalendarObjectFromNewShift = async(newShift) => {
	const dates = newShift.dates
	const shiftsType = newShift.shiftsType
	const analysts = newShift.analysts

	const timezone = findCurrentTimezone()
	const shiftsCalendar = await findShiftsCalendar()
	await Promise.all(dates.map(async(date) => {
		const eventComponent = createEventComponent(
			calcShiftDate(date, shiftsType.startTimestamp),
			calcShiftDate(date, shiftsType.stopTimestamp),
			timezone)

		let title = shiftsType.name + ': '

		eventComponent.setOrganizerFromNameAndEMail(organizerName, organizerEmail)

		analysts.forEach((analyst) => {
			const attendee = createAttendeeFromAnalyst(analyst, timezone)
			title = title + ' ' + analyst.commonName
			eventComponent.addProperty(attendee)
		})

		eventComponent.title = title

		if (eventComponent.isDirty()) {
			await shiftsCalendar.createVObject(eventComponent.root.toICS())
		}
	}))
}

const updateExistingCalendarObjectFromShiftsChange = async(oldShift, newShift, oldAnalyst, newAnalyst) => {
	const oldShiftsDate = oldShift.date
	const oldShiftsType = oldShift.shiftsType

	const timezone = findCurrentTimezone()
	const shiftsCalendar = await findShiftsCalendar('Leitstellen Schichtplan')

	let [oldVObject, oldEventComponent] = await findEventComponent(shiftsCalendar, oldShiftsDate, oldShiftsType, timezone)

	oldEventComponent = editEventComponent(oldEventComponent, oldAnalyst, newAnalyst, timezone)

	if (oldEventComponent.isDirty()) {
		oldVObject.data = oldEventComponent.root.toICS()
		await oldVObject.update()
	}

	if (newShift) {
		const newShiftsType = newShift.shiftsType
		const newShiftsDate = newShift.date
		let [newVObject, newEventComponent] = await findEventComponent(shiftsCalendar, newShiftsDate, newShiftsType, timezone)

		newEventComponent = editEventComponent(newEventComponent, newAnalyst, oldAnalyst, timezone)

		if (newEventComponent.isDirty()) {
			newVObject.data = newEventComponent.root.toICS()
			await newVObject.update()
		}
	}
}

const moveExistingCalendarObject = async(shiftsType, oldDate, newDate, oldAnalyst, newAnalyst) => {
	const timezone = findCurrentTimezone()
	const shiftsCalendar = await findShiftsCalendar('Leitstellen Schichtplan')

	const [vObject, eventComponent] = await findEventComponent(shiftsCalendar, oldDate, shiftsType, timezone)
	const attendeeIterator = eventComponent.getPropertyIterator('ATTENDEE')
	const attendees = Array.from(attendeeIterator)
	try {
		const [newVObject, newEventComponent] = await findEventComponent(shiftsCalendar, newDate, shiftsType, timezone)

		const attendee = createAttendeeFromAnalyst(newAnalyst, timezone)

		newEventComponent.addProperty(attendee)
		newEventComponent.title = newEventComponent.title + ' ' + newAnalyst.name

		if (newEventComponent.isDirty()) {
			newVObject.data = newEventComponent.root.toICS()
			await newVObject.update()
		}
	} catch (e) {
		console.log(e)
		const newEventComponent = createEventComponent(
			calcShiftDate(newDate, shiftsType.startTimestamp),
			calcShiftDate(newDate, shiftsType.stopTimestamp),
			timezone)

		let title = shiftsType.name + ': '

		newEventComponent.setOrganizerFromNameAndEMail(organizerName, organizerEmail)

		const attendee = createAttendeeFromAnalyst(newAnalyst, timezone)
		title = title + ' ' + newAnalyst.name
		newEventComponent.addProperty(attendee)

		newEventComponent.title = title

		if (newEventComponent.isDirty()) {
			await shiftsCalendar.createVObject(newEventComponent.root.toICS())
		}
	}

	if (attendees.length === 1) {
		await vObject.delete()
	} else {
		const attendeeToBeRemoved = attendees.find((attendee) => {
			return attendee.email === 'mailto:' + oldAnalyst.email
		})
		console.log(attendeeToBeRemoved)
		eventComponent.removeAttendee(attendeeToBeRemoved)
		eventComponent.title = eventComponent.title.replace(' ' + oldAnalyst.name, '')

		if (eventComponent.isDirty()) {
			vObject.data = eventComponent.root.toICS()
			await vObject.update()
		}
	}
}

const deleteExistingCalendarObject = async(shiftsType, shift, analyst) => {
	const timezone = findCurrentTimezone()
	const shiftsCalendar = await findShiftsCalendar()

	const [vObject, eventComponent] = await findEventComponent(shiftsCalendar, shift.date, shiftsType, timezone)

	const attendeeIterator = eventComponent.getPropertyIterator('ATTENDEE')
	const attendees = Array.from(attendeeIterator)

	if (attendees.length === 1) {
		await vObject.delete()
	} else {
		const attendeeToBeRemoved = attendees.find((attendee) => {
			return attendee.email === 'mailto:' + analyst.email
		})

		eventComponent.removeAttendee(attendeeToBeRemoved)
		eventComponent.title = eventComponent.title.replace(' ' + analyst.name, '')

		if (eventComponent.isDirty()) {
			vObject.data = eventComponent.root.toICS()
			await vObject.update()
		}
	}

}

/**
 * synchronizes the calendar for a given ShiftsType and a list of
 *
 * @param {Calendar} calendar Shifts-Calendar
 * @param {Object} shiftsType ShiftsType of the Shift
 * @param {String} dateString Date of Shifts
 * @param {array} analysts list of participating analysts
 */
const syncCalendarObject = async(calendar, shiftsType, dateString, analysts) => {
	try {
		// eslint-disable-next-line
		const [vObject, eventComponent] = await findEventComponent(calendar, dateString, shiftsType, timezone)
		const attendeeIterator = eventComponent.getPropertyIterator('ATTENDEE')
		const attendees = Array.from(attendeeIterator)
		for (const analyst of analysts) {
			if (!attendees.some(attendee => attendee.email === 'mailto:' + analyst.email)) {

				const attendee = createAttendeeFromAnalyst(analyst)

				eventComponent.addProperty(attendee)

				eventComponent.title = eventComponent.title + ' ' + analyst.name
			}
		}
		for (const attendee of attendees) {
			if (!analysts.some(analyst => attendee.email === 'mailto:' + analyst.email)) {
				eventComponent.removeAttendee(attendee)

				eventComponent.title = eventComponent.title.replace(attendee.commonName, '')
			}
		}

		if (eventComponent.isDirty()) {
			vObject.data = eventComponent.root.toICS()
			await vObject.update()
		}
	} catch (e) {
		if (e.message.includes('Could not find corresponding Event')) {
			const eventComponent = createEventComponent(
				calcShiftDate(dateString, shiftsType.startTimestamp),
				calcShiftDate(dateString, shiftsType.stopTimestamp))

			let title = shiftsType.name + ': '

			eventComponent.setOrganizerFromNameAndEMail(organizerName, organizerEmail)
			console.log(analysts)
			analysts.forEach((analyst) => {
				console.log(analyst)
				const attendee = createAttendeeFromAnalyst(analyst)
				title = title + ' ' + analyst.name
				eventComponent.addProperty(attendee)
			})

			eventComponent.title = title

			if (eventComponent.isDirty()) {
				await calendar.createVObject(eventComponent.root.toICS())
			}
		} else {
			throw new Error(e)
		}
	}
}

/**
 * returns the dedicated Shifts-Calendar based on the Organizers name
 *
 * @returns {Calendar}
 */
let calendar
const findShiftsCalendar = async() => {
	if (!calendar || calendar.owner.includes(organizerName)) {
		const calendars = await findAllCalendars()
		calendar = calendars.find(calendar => {
			return calendar.owner.includes(organizerName) && calendar.displayname.includes('Leitstellen')
		})
		return calendar
	} else {
		return calendar
	}
}

/**
 * creates an Eventcomponent from Timestamps
 *
 * @param {Date} startDate Date of start of new event
 * @param {Date} stopDate Date of stop of new event
 *
 * @returns {EventComponent}
 */
const createEventComponent = (startDate, stopDate) => {
	const startDateTime = DateTimeValue
		.fromJSDate(startDate, true)
		.getInTimezone(timezone)
	const endDateTime = DateTimeValue
		.fromJSDate(stopDate, true)
		.getInTimezone(timezone)

	const calendarComponent = createEvent(startDateTime, endDateTime)
	for (const vObject of calendarComponent.getVObjectIterator()) {
		vObject.undirtify()
	}

	const iterator = calendarComponent.getVObjectIterator()

	const firstVObject = iterator.next().value
	if (!firstVObject) {
		throw new Error('Could not find Event')
	}

	return firstVObject.recurrenceManager.getOccurrenceAtExactly(startDateTime)
}

/**
 * returns AttendeeProperty from Analyst
 *
 * @param {Object} analyst Analyst-Object of attendee to be created
 *
 * @returns {AttendeeProperty}
 */
const createAttendeeFromAnalyst = (analyst) => {
	let name = ''
	if (analyst.name) {
		name = analyst.name
	} else {
		name = analyst.commonName
	}
	const attendee = AttendeeProperty.fromNameAndEMail(name, analyst.email)

	attendee.userType = 'INDIVIDUAL'
	attendee.participationStatus = 'NEEDS-ACTION'
	attendee.role = 'REQ-PARTICIPANT'
	attendee.rsvp = true
	attendee.updateParameterIfExist('TZID', timezone.timezoneId)

	return attendee
}

/**
 * edit EventComponent
 *
 * @param {EventComponent} event Event to be edited
 * @param {Object} removeAnalyst Old Analyst Object to be removed from EventComponent
 * @param {Object} addAnalyst New Analyst Object to be added to EventComponent
 * @param {Timezone} timezone Timezone of the current instance
 *
 * @returns {EventComponent}
 */

const editEventComponent = (event, removeAnalyst, addAnalyst, timezone) => {
	const attendeeIterator = event.getPropertyIterator('ATTENDEE')

	let attendeeToBeRemoved
	for (const attendee of attendeeIterator) {
		if (attendee.email === 'mailto:' + removeAnalyst.email) {
			attendeeToBeRemoved = attendee
			break
		}
	}

	if (!attendeeToBeRemoved) {
		throw new Error('Could not edit Event')
	}
	event.removeAttendee(attendeeToBeRemoved)

	event.title = event.title.replace(removeAnalyst.name, addAnalyst.name)

	const newAttendee = createAttendeeFromAnalyst(addAnalyst, timezone)

	event.addProperty(newAttendee)

	return event
}

/**
 * find EventComponent by Date
 *
 * @param {Calendar} calendar Shifts-Calendar to find Events in
 * @param {String} dateString Date-String of the Shift
 * @param {Object} shiftsType ShiftsType of the Shift
 * @param {Timezone} timezone Timezone of the current instance
 *
 * @returns {[VObject,EventComponent]}
 */
const findEventComponent = async(calendar, dateString, shiftsType, timezone) => {
	const vObjects = await calendar.findByTypeInTimeRange('VEVENT',
		calcShiftDate(dateString, shiftsType.startTimestamp),
		calcShiftDate(dateString, shiftsType.stopTimestamp))
	if (vObjects.length <= 0) {
		throw new Error('Could not find corresponding Events')
	}

	let vObject
	for (const obj of vObjects) {
		if (obj.data.includes(`SUMMARY:${shiftsType.name}`)) {
			vObject = obj
			break
		}
	}

	if (!vObject) {
		throw new Error('Could not find corresponding Event')
	}

	const parserManager = getParserManager()
	const parser = parserManager.getParserForFileType('text/calendar')

	// This should not be the case, but let's just be on the safe side
	if (typeof vObject.data !== 'string' || vObject.data.trim() === '') {
		throw new Error('Empty calendar object')
	}

	parser.parse(vObject.data)

	const calendarComponentIterator = parser.getItemIterator()
	const calendarComponent = calendarComponentIterator.next().value
	if (!calendarComponent) {
		throw new Error('Empty calendar object')
	}
	const iterator = calendarComponent.getVObjectIterator()
	const firstVObject = iterator.next().value
	if (!firstVObject) {
		return
	}

	const startDateTime = DateTimeValue
		.fromJSDate(calcShiftDate(dateString, shiftsType.startTimestamp), true)
		.getInTimezone(timezone)

	return [vObject, firstVObject.recurrenceManager.getOccurrenceAtExactly(startDateTime)]
}

export {
	saveCalendarObjectFromNewShift,
	updateExistingCalendarObjectFromShiftsChange,
	moveExistingCalendarObject,
	deleteExistingCalendarObject,
	syncAllAssignedShifts,
}
